// GMC Maritime Academy Student Registry — central server (single file, no installation).
//
//   - Keeps the registry (students, subjects, grades…) in ONE place for every PC of the academy.
//   - Accounts: admin (everything), teacher (grades of his subjects/classes) and student
//     (only his own exams and the syllabus PDFs of his subjects — never any grades).
//     On a new server the first administrator is created from the app (username + password).
//   - Exams: created/assigned/scheduled by the admin, taken by students in the app, graded automatically.
//     Exam scores are an intermediate test: they are never written into the final course grades.
//
// Usage:  GMC-Registry-Server[.exe] [--port 8080] [--data <folder>] [--allow private|any|192.168.1.0/24]
//
//	[--reset-admin user:password]
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Version = "2.2.0"

func osReadFile(p string) ([]byte, error) { return os.ReadFile(p) }

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func defaultDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "GMC-Registry-Data"
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return filepath.Join(filepath.Dir(exe), "GMC-Registry-Data")
}

// pause keeps the console window open on Windows when something went wrong (double-click start).
func pause() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Println()
	fmt.Println("Πατήστε Enter για κλείσιμο…")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func lanAddresses() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok {
				if ip := n.IP.To4(); ip != nil && ip.IsPrivate() {
					out = append(out, ip.String())
				}
			}
		}
	}
	sort.Strings(out)
	return out
}

func main() {
	defPort, _ := strconv.Atoi(envOr("PORT", "8080"))
	defHours, _ := strconv.ParseFloat(envOr("SESSION_HOURS", "12"), 64)
	port := flag.Int("port", defPort, "θύρα (port)")
	dataDir := flag.String("data", envOr("DATA_DIR", defaultDataDir()), "φάκελος δεδομένων")
	allow := flag.String("allow", envOr("ALLOW_NETWORKS", "private"), "δίκτυα που επιτρέπονται: private | any | 192.168.1.0/24,…")
	hours := flag.Float64("session-hours", defHours, "διάρκεια σύνδεσης διαχειριστή (ώρες)")
	resetAdmin := flag.String("reset-admin", os.Getenv("RESET_ADMIN"), "ξεχασμένος κωδικός: όνομα:κωδικός διαχειριστή")
	testMode := flag.Bool("test-mode", false, "μόνο για αυτόματους ελέγχους")
	grace := flag.Int("grace-seconds", 45, "περιθώριο υποβολής μετά τη λήξη του χρόνου (δευτερόλεπτα)")
	flag.Parse()

	abs, err := filepath.Abs(*dataDir)
	if err == nil {
		*dataDir = abs
	}
	st, err := openStore(*dataDir)
	if err != nil {
		fmt.Println("ΣΦΑΛΜΑ:", err)
		pause()
		os.Exit(1)
	}

	// log to the console and to <data>/server.log
	logFile, _ := os.OpenFile(filepath.Join(*dataDir, "server.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	var w io.Writer = os.Stdout
	if logFile != nil {
		w = io.MultiWriter(os.Stdout, logFile)
	}
	logger := log.New(w, "", log.LstdFlags)
	logf := func(f string, a ...any) { logger.Printf(f, a...) }

	s := &Server{cfg: Config{Port: *port, DataDir: *dataDir, Allow: *allow, SessionHours: *hours, GraceMs: int64(*grace) * 1000, TestMode: *testMode}, st: st, netOK: makeNetCheck(*allow), logf: logf, failures: map[string]*failure{}}

	if *resetAdmin != "" {
		if err := resetAdminAccount(st, *resetAdmin); err != nil {
			fmt.Println("ΣΦΑΛΜΑ --reset-admin:", err)
			pause()
			os.Exit(1)
		}
		logf("[setup] Ο κωδικός του διαχειριστή ορίστηκε από το --reset-admin. Αφαιρέστε τη ρύθμιση μετά τη σύνδεση.")
	}

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		fmt.Printf("ΣΦΑΛΜΑ: η θύρα %d δεν είναι διαθέσιμη (%v).\nΜήπως ο διακομιστής τρέχει ήδη σε άλλο παράθυρο;\n", *port, err)
		pause()
		os.Exit(1)
	}
	srv := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 15 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 5 * time.Minute, IdleTimeout: 2 * time.Minute}

	fmt.Println("════════════════════════════════════════════════════════════")
	fmt.Println(" GMC Maritime Academy — Κεντρικός διακομιστής", Version)
	fmt.Println("════════════════════════════════════════════════════════════")
	fmt.Println(" Λειτουργεί. Μην κλείσετε αυτό το παράθυρο όσο χρησιμοποιείται.")
	fmt.Println()
	fmt.Println(" Διεύθυνση για το πρόγραμμα:")
	fmt.Printf("   σε αυτόν τον υπολογιστή:   127.0.0.1:%d\n", *port)
	for _, ip := range lanAddresses() {
		fmt.Printf("   από άλλους υπολογιστές:   %s:%d\n", ip, *port)
	}
	fmt.Println()
	fmt.Println(" Δεδομένα:", *dataDir)
	st.mu.Lock()
	if st.adminCount(false) == 0 {
		fmt.Println(" Πρώτη εκκίνηση: ανοίξτε το πρόγραμμα — θα σας ζητήσει όνομα χρήστη")
		fmt.Println(" και κωδικό για τον διαχειριστή.")
	}
	st.mu.Unlock()
	fmt.Println("════════════════════════════════════════════════════════════")
	logf("GMC Registry Server %s — θύρα %d, δίκτυα: %s", Version, *port, *allow)

	// housekeeping: close expired exam attempts, persist sessions, daily zip backup
	go func() {
		t15 := time.NewTicker(15 * time.Second)
		th := time.NewTicker(time.Hour)
		st.dailyBackup(logf)
		for {
			select {
			case <-t15.C:
				st.mu.Lock()
				s.sweepExpired()
				if st.sessDirty {
					st.saveSessions()
				}
				st.mu.Unlock()
			case <-th.C:
				st.dailyBackup(logf)
			}
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		logf("Τερματισμός…")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logf("ΣΦΑΛΜΑ: %v", err)
		pause()
		os.Exit(1)
	}
	st.mu.Lock()
	st.saveSessions()
	st.mu.Unlock()
}

// resetAdminAccount: "user:password" → that administrator gets this password (created if missing).
func resetAdminAccount(st *Store, spec string) error {
	i := strings.Index(spec, ":")
	if i <= 0 {
		return errors.New("μορφή: όνομα:κωδικός")
	}
	username, pw := strings.TrimSpace(spec[:i]), spec[i+1:]
	if err := validAdminName(username); err != nil {
		return err
	}
	if len([]rune(pw)) < 8 {
		return errors.New("ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες")
	}
	hash, salt := hashPassword(pw)
	st.mu.Lock()
	defer st.mu.Unlock()
	u := st.userByName(username)
	if u == nil {
		u = &User{ID: st.counters.NextUserID, Username: username, Role: "admin", DisplayName: username, CreatedAt: nowMs()}
		st.counters.NextUserID++
		st.users = append(st.users, u)
		st.saveCounters()
	}
	u.Role, u.AM = "admin", ""
	u.PassHash, u.PassSalt, u.Active, u.MustChange = hash, salt, true, false
	return st.saveUsers()
}
