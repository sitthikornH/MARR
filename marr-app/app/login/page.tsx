"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AuthUser } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");

      const me = (await (await fetch("/api/auth/me")).json()) as AuthUser;
      router.replace(me.must_change_password ? "/change-password" : me.role === "admin" ? "/" : "/welfare");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">Project MARR</h1>
      <p className="mt-1 text-sm text-gray-500">Sign in to see your welfare reports.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            placeholder="Email name before @"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Password / PIN</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="First login: your phone number"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <p className="mt-6 text-xs text-gray-500">
        Username is the part of your email before @ (or your employee code if you have no email). The first
        time, your password is the phone number registered in TimeMint; you will then set a 4-digit PIN.
      </p>
    </div>
  );
}
