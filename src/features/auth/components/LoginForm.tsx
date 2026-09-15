"use client";

import { useState } from "react";
import { signIn } from "../session";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError("");
    const result = await signIn(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form className="auth-form" action={onSubmit}>
      <input type="hidden" name="next" value={nextPath} />
      <label className="field">
        <span>이메일</span>
        <input type="email" name="email" autoComplete="email" required placeholder="you@example.com" />
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input type="password" name="password" autoComplete="current-password" required minLength={8} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? "들어가는 중..." : "우리 공간으로"}</button>
    </form>
  );
}
