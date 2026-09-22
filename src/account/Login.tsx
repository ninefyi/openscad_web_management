import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../api/accountClient";
import { useAccount } from "../state/AccountContext";

export function Login() {
  const navigate = useNavigate();
  const { setAccount } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const account = await login(email, password);
      setAccount(account);
      navigate("/designs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-page">
      <h1>Sign in</h1>
      <form className="account-form" onSubmit={handleSubmit}>
        {error && <p className="account-error">{error}</p>}
        <label className="account-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="account-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="export-button" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="account-page-footer">
        Don't have an account? <Link to="/signup">Create one</Link>
      </p>
    </div>
  );
}
