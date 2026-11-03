"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { AuthUser } from "@/lib/types";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  const isAdmin = me?.role === "admin";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (isAdmin ? next.length < 8 : !/^\d{4}$/.test(next)) {
      setError(isAdmin ? "Admin password must be at least 8 characters." : "PIN must be exactly 4 digits.");
      return;
    }
    if (next !== confirm) {
      setError("The two new entries don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      router.replace(isAdmin ? "/" : "/welfare");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const pinInput = isAdmin ? {} : { inputMode: "numeric" as const, maxLength: 4, pattern: "\\d{4}" };

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">{isAdmin ? "Change password" : "Set your PIN"}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {me?.must_change_password
          ? isAdmin
            ? "Please set a new password before continuing."
            : "First login: enter your phone number, then choose a 4-digit PIN for next time."
          : isAdmin
            ? "At least 8 characters."
            : "Your PIN is 4 digits."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">
            {me?.must_change_password && !isAdmin ? "Phone number (current password)" : "Current password / PIN"}
          </label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">{isAdmin ? "New password" : "New 4-digit PIN"}</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            {...pinInput}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Confirm</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            {...pinInput}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !current || !next || !confirm}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
