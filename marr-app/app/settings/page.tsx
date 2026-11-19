"use client";

import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/types";
import AutoImportSection from "./AutoImportSection";
import FixHistorySection from "./FixHistorySection";
import LoginHistorySection from "./LoginHistorySection";

export default function SettingsPage() {
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
    loadSettings();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">System configuration.</p>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading settings...</p>}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {settings && <AutoImportSection settings={settings} onSaved={setSettings} onReload={loadSettings} />}

      <FixHistorySection />

      <LoginHistorySection />
    </div>
  );
}
