'use client';

import { useCallback, useRef, useState } from 'react';
import { buildDownloadName, formatSize, isAcceptedFile } from '../../lib/file-types';
import { runCrypto } from '../../lib/run-pdf';
import { ToolIntro } from '../_components/tool-intro';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { ToolShell } from '../_components/tool-shell';
import { downloadBytes } from '../_lib/download';
import { useDocumentSession } from '../_lib/use-document';

/** Which restrictions are worth naming to someone deciding whether to bother. */
const NOTABLE = [
  ['print', 'printing'],
  ['copy', 'copying text'],
  ['modify', 'editing'],
  ['annotate', 'commenting'],
];

function describeRestrictions(permissions) {
  const blocked = NOTABLE.filter(([id]) => permissions && permissions[id] === false).map(([, label]) => label);
  if (blocked.length === 0) return null;
  if (blocked.length === 1) return `${blocked[0]} is blocked`;
  return `${blocked.slice(0, -1).join(', ')} and ${blocked.at(-1)} are blocked`;
}

export default function UnlockTool() {
  const session = useDocumentSession();
  const { showToast, addFiles } = session;

  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(null);
  const passwordRef = useRef(null);

  const reset = () => {
    setInfo(null);
    setPassword('');
    setError('');
    setDone(null);
  };

  const onFiles = useCallback(
    async (list) => {
      const chosen = list[0];
      if (!chosen) return;
      if (!isAcceptedFile(chosen) || !/\.pdf$/i.test(chosen.name)) {
        showToast('Choose a PDF. Only PDFs can be password-protected.', true);
        return;
      }
      setFile(chosen);
      reset();
      setBusy(true);
      setProgress('Checking...');
      try {
        const buffer = await chosen.arrayBuffer();
        const result = await runCrypto({ kind: 'inspect', bytes: buffer }).promise;
        setInfo(result);
        if (result.needsPassword) setTimeout(() => passwordRef.current?.focus(), 0);
      } catch (err) {
        setInfo(null);
        setError(err.message);
      } finally {
        setBusy(false);
        setProgress('');
      }
    },
    [showToast],
  );

  const unlock = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const job = runCrypto({ kind: 'unlock', bytes: buffer, password, onProgress: setProgress });
      const result = await job.promise;

      const name = buildDownloadName(file.name, 'unlocked');
      downloadBytes(result.bytes, name);
      setDone({ name, algorithm: result.algorithm });

      // Hand the result to the rest of the app, so "unlock, then split" does not mean loading
      // the same document twice.
      addFiles([new File([result.bytes], name, { type: 'application/pdf' })]);
      showToast('Protection removed. The unlocked PDF is ready in the other tools too.');
    } catch (err) {
      // The worker sends the error's name along with its message, because a structured clone
      // drops the class and these three need three different responses.
      if (err.name === 'WrongPassword') {
        setError('That password did not work. Check for capitals and stray spaces.');
        passwordRef.current?.select();
      } else if (err.name === 'PasswordRequired') {
        setError('This PDF needs its password to be opened.');
        passwordRef.current?.focus();
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [file, password, busy, addFiles, showToast]);

  const restrictions = info?.encrypted ? describeRestrictions(info.permissions) : null;
  const ready = info?.encrypted && (!info.needsPassword || password.length > 0);

  return (
    <ToolShell
      title="Unlock a PDF"
      tagline="Remove a password or restrictions - on your device, never uploaded."
    >
      <main className="layout layout-centered">
        <div className="panel-left panel-centered">
          <DropZone
            onFiles={onFiles}
            multiple={false}
            accept="application/pdf,.pdf"
            label="Browse for a PDF to unlock"
            hint="PDF only"
          />

          {!file && <ToolIntro id="unlock" />}

          {file && (
            <section className="tool-panel" aria-label="Protection">
              <div className="tool-panel-head">
                <h2>{file.name}</h2>
                <span className="merge-meta">{formatSize(file.size)}</span>
              </div>

              {info && !info.encrypted && (
                <p className="field-help">
                  This PDF is not protected, so there is nothing to remove.
                </p>
              )}

              {info?.encrypted && (
                <>
                  <p className="field-help">
                    {info.needsPassword
                      ? `Protected with ${info.algorithm}. It needs its password to be opened.`
                      : `Restricted with ${info.algorithm}. It opens without a password${
                          restrictions ? `, but ${restrictions}` : ''
                        }.`}
                  </p>

                  {info.needsPassword && (
                    <label className="setting setting-wide">
                      <span className="setting-label">Password</span>
                      <input
                        ref={passwordRef}
                        type="password"
                        autoComplete="off"
                        value={password}
                        placeholder="The password you use to open it"
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') unlock();
                        }}
                      />
                    </label>
                  )}
                </>
              )}

              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={unlock}
                  disabled={busy || !ready}
                >
                  Remove protection &amp; Download
                </button>
              </div>

              {done && <p className="field-help">Saved as {done.name}.</p>}

              <p className="tool-note">
                This removes a password you already know, or restrictions that need no password
                at all. It cannot recover a password you have forgotten.
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
