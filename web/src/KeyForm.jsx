import { useState } from 'react';

export default function KeyForm({ error, onSubmit }) {
  const [value, setValue] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(value.trim());
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <label htmlFor="api-key">API key</label>
      <input
        id="api-key"
        type="password"
        autoComplete="off"
        autoFocus
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="primary">Continue</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
