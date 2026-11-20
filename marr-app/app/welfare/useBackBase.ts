"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/types";

/** Where the TimeMint/OT/Fixed Time Request pages' "Back" link should go: /supervisor for a
 *  supervisor, /welfare for everyone else (admin or user). */
export function useBackBase(): string {
  const [base, setBase] = useState("/welfare");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? (res.json() as Promise<AuthUser>) : null))
      .then((me) => {
        if (!cancelled && me?.role === "supervisor") setBase("/supervisor");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return base;
}
