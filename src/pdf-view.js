/*
 * In-app PDF viewer (App.pdfViewer), shared by the student, teacher and admin screens.
 *
 *   App.pdfViewer.open({ title, bytes, fileName, lang: 'en' | 'el', sub })
 *     title    heading of the dialog (defaults to the file name)
 *     bytes    Uint8Array (or ArrayBuffer) with the PDF
 *     fileName suggested name for «Save a copy» (".pdf" is added when missing)
 *     lang     'el' (default) or 'en' — labels of the dialog
 *     sub      optional second line under the title (plain text)
 *   → the modal context ({ close(), el, … }); the blob: URL is revoked when the dialog closes.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  const T = {
    el: {
      save: 'Αποθήκευση αντιγράφου',
      close: 'Κλείσιμο',
      saveTitle: 'Αποθήκευση αντιγράφου PDF',
      saved: 'Αποθηκεύτηκε: ',
      open: 'Άνοιγμα',
      failed: 'Η αποθήκευση απέτυχε: ',
      frame: 'Προβολή PDF',
    },
    en: {
      save: 'Save a copy',
      close: 'Close',
      saveTitle: 'Save a copy of the PDF',
      saved: 'Saved: ',
      open: 'Open',
      failed: 'Could not save the file: ',
      frame: 'PDF viewer',
    },
  };

  /** A name Windows accepts, always ending in .pdf. */
  function safeName(name) {
    let n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
    if (!n) n = 'document';
    if (!/\.pdf$/i.test(n)) n += '.pdf';
    return n;
  }

  function open(opts) {
    const o = opts || {};
    const { esc, openModal, toast } = App.ui;
    const t = T[o.lang === 'en' ? 'en' : 'el'];
    const bytes = o.bytes instanceof Uint8Array ? o.bytes : new Uint8Array(o.bytes || []);
    const fileName = safeName(o.fileName || o.title);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    return openModal({
      title: o.title || fileName,
      sub: o.sub ? esc(o.sub) : '',
      size: 'pdfv',
      body: '<iframe class="pdfv-frame" src="' + url + '" title="' + esc(t.frame) + '"></iframe>',
      buttons: [
        {
          label: t.save,
          icon: 'download',
          left: true,
          id: 'pdfv-save',
          keepOpen: true,
          onClick: async () => {
            let r;
            try {
              r = await window.api.saveFile({ title: t.saveTitle, defaultName: fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }], data: bytes });
            } catch (e) {
              throw new Error(t.failed + (e && e.message ? e.message : String(e)));
            }
            if (!r) return; // cancelled
            toast(esc(t.saved) + '<b>' + esc(r.name || fileName) + '</b>', 'success', r.path && window.api.openPath ? { action: { label: t.open, onClick: () => window.api.openPath(r.path) } } : undefined);
          },
        },
        { label: t.close, cls: 'btn-primary', id: 'pdfv-close' },
      ],
      onMount(ctx) {
        const x = ctx.q('[data-mclose]');
        if (x) x.title = t.close;
      },
      onClose() {
        URL.revokeObjectURL(url);
        if (typeof o.onClose === 'function') o.onClose();
      },
    });
  }

  App.pdfViewer = { open, safeName };
})();
