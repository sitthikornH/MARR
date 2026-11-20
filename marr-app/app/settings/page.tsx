"use client";

import { useEffect, useState } from "react";
import type { AppSettings, AuthUser } from "@/lib/types";
import AutoImportSection from "./AutoImportSection";
import FixHistorySection from "./FixHistorySection";
import LoginHistorySection from "./LoginHistorySection";
import SupervisorsSection from "./SupervisorsSection";

/**
 * Admins see every section. A supervisor only ever reaches this page with the Time Adjustment
 * History permission (see NavBar/lib/auth.ts canManageTimeAdjustmentHistory) and sees only that
 * one section — Auto Import, Supervisors and Login History stay admin-only.
 */
export default function SettingsPage() {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      setSettings(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? (res.json() as Promise<AuthUser>) : null))
      .then((user) => {
        setMe(user);
        if (user?.role === "admin") loadSettings();
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const isAdmin = me?.role === "admin";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">System configuration.</p>
      </div>

      {isAdmin && loading && <p className="text-sm text-gray-500">Loading settings...</p>}
      {isAdmin && !loading && error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && settings && <AutoImportSection settings={settings} onSaved={setSettings} onReload={loadSettings} />}

      {isAdmin && <SupervisorsSection />}

      {(isAdmin || me?.can_manage_time_adjustment_history) && <FixHistorySection />}

      {isAdmin && <LoginHistorySection />}
    </div>
  );
}
