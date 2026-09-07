'use client';

import { useCallback, useState } from 'react';
import { buildDownloadName, formatSize, isAcceptedFile } from '../../lib/file-types';
import { runCrypto } from '../../lib/run-pdf';
import { ToolIntro } from '../_components/tool-intro';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { ToolShell } from '../_components/tool-shell';
import { downloadBytes } from '../_lib/download';
import { useDocumentSession } from '../_lib/use-document';

/**
 * The three restrictions worth offering.
 *
 * The format defines eight, but the other five are variations nobody asks for by name
 * ("high-quality printing", "assembling pages"). Showing all eight would make a simple task
 * look like a configuration screen.
 */
const RESTRICTIONS = [
  { id: 'print', label: 'Printing' },
  { id: 'copy', label: 'Copying text and images' },
  { id: 'modify', label: 'Editing the document' },
];

export default function ProtectTool() {
  const session = useDocumentSession();
  const { showToast } = session;

  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [allowed, setAllowed] = useState({ print: true, copy: true, modify: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(null);

  const onFiles = useCallback(
    (list) => {
      const chosen = list[0];
      if (!chosen) return;
      if (!isAcceptedFile(chosen) || !/\.pdf$/i.test(chosen.name)) {
        showToast('Choose a PDF. Only PDFs can be password-protected.', true);
        return;
      }
      setFile(chosen);
      setError('');
      setDone(null);
    },
    [showToast],
  );

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = file && password.length > 0 && password === confirm;

  const protectFile = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const result = await runCrypto({
        kind: 'protect',
        bytes: buffer,
        options: {
          userPassword: password,
          // Restrictions only bind when an owner password exists that can lift them. Reusing
          // the user password keeps this to one field: anyone who can open the document can
          // also lift its restrictions, which is the honest arrangement for a single password.
          ownerPassword: password,
          permissions: {
            ...allowed,
            annotate: allowed.modify,
            fillForms: true,
            extractForAccessibility: true,
            assemble: allowed.modify,
            printHighQuality: allowed.print,
          },
        },
        onProgress: setProgress,
      }).promise;

      const name = buildDownloadName(file.name, 'protected');
      downloadBytes(result.bytes, name);
      setDone({ name });
      showToast('Protected and downloaded.');
    } catch (err) {
      setError(
        err.name === 'AlreadyEncrypted'
          ? 'This PDF is already protected. Unlock it first, then protect it again.'
          : err.message,
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [ready, busy, file, password, allowed, showToast]);

  return (
    <ToolShell
      title="Protect a PDF"
      tagline="Add a password with AES-256 - encrypted on your device, never uploaded."
    >
      <main className="layout layout-centered">
        <div className="panel-left panel-centered">
          <DropZone
            onFiles={onFiles}
            multiple={false}
            accept="application/pdf,.pdf"
            label="Browse for a PDF to protect"
            hint="PDF only"
          />

          {!file && <ToolIntro id="protect" />}

          {file && (
            <section className="tool-panel" aria-label="Protection settings">
              <div className="tool-panel-head">
                <h2>{file.name}</h2>
                <span className="merge-meta">{formatSize(file.size)}</span>
              </div>

              <label className="setting setting-wide">
                <span className="setting-label">Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  placeholder="Needed to open the document"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
              </label>

              <label className="setting setting-wide">
                <span className="setting-label">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') protectFile();
                  }}
                />
              </label>

              {mismatch ? (
                <p className="field-error" role="alert">
                  The two passwords do not match.
                </p>
              ) : (
                <p className="field-help">
                  There is no way to recover this password - not here, and not anywhere.
                  Keep it somewhere safe before you download.
                </p>
              )}

              <fieldset className="restrictions">
                <legend className="setting-label">Also allow</legend>
                {RESTRICTIONS.map((restriction) => (
                  <label key={restriction.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={allowed[restriction.id]}
                      onChange={(e) =>
                        setAllowed((prev) => ({ ...prev, [restriction.id]: e.target.checked }))
                      }
                    />
                    {restriction.label}
                  </label>
                ))}
              </fieldset>

              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={protectFile}
                  disabled={busy || !ready}
                >
                  Protect &amp; Download
                </button>
              </div>

              {done && <p className="field-help">Saved as {done.name}.</p>}

              <p className="tool-note">
                The password really does keep the contents unreadable. The boxes above are
                different: they are recorded in the file and every well-behaved reader obeys
                them, but nothing enforces them the way the password does.
              </p>
            </section>
          )}
        </div>

        {busy && <ProgressOverlay message={progress} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
