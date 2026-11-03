import { useState } from 'react';

export default function KeyForm({ error, onSubmit }) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(value.trim());
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <label htmlFor="api-key">API key</label>
      <div className="secret">
        <input
          id="api-key"
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck="false"
          autoFocus
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="eye"
          aria-label={visible ? 'Hide API key' : 'Show API key'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>
      <button className="primary">Continue</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
