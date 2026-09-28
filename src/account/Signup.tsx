import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { signup } from "../api/accountClient";
import { useAccount } from "../state/AccountContext";
import { safeReturnPath, signInPath } from "./signInReturn";

export function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("next"));
  const { setAccount } = useAccount();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const account = await signup(name, email, password);
      setAccount(account);
      navigate(returnTo ?? "/designs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-page">
      <h1>Create an account</h1>
      <p className="account-page-subtitle">
        Free — lets you save a design and come back to it later.
      </p>
      <form className="account-form" onSubmit={handleSubmit}>
        {error && <p className="account-error">{error}</p>}
        <label className="account-field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
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
            minLength={8}
            required
          />
        </label>
        <button className="export-button" type="submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="account-page-footer">
        Already have an account? <Link to={returnTo ? signInPath(returnTo) : "/login"}>Sign in</Link>
      </p>
    </div>
  );
}
