"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "@/lib/types";
import { useIdleLogout } from "./useIdleLogout";

const ADMIN_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/attendance", label: "Attendance" },
  { href: "/welfare", label: "Welfare Summary" },
  { href: "/settings", label: "Settings" },
];
const USER_LINKS = [{ href: "/welfare", label: "Welfare Summary" }];

// Pages an employee (role user) may open; anything else sends them to Welfare Summary.
const USER_PAGES = ["/welfare", "/welfare/allowance-report", "/welfare/mileage", "/welfare/timemint", "/welfare/ot", "/welfare/fixed-time", "/change-password"];

/** Global header: role-aware links, the signed-in user and Logout. Also redirects by session state. */
export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    let cancelled = false;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) return;
        const user = (await res.json()) as AuthUser;
        setMe(user);
        if (user.must_change_password && pathname !== "/change-password") router.replace("/change-password");
        else if (user.role === "user" && !USER_PAGES.includes(pathname)) router.replace("/welfare");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const onIdle = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        setMe(null);
        router.replace("/login?expired=1");
      });
  }, [router]);
  useIdleLogout(pathname !== "/login", onIdle);

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    router.replace("/login");
  }

  const links = me?.must_change_password ? [] : me?.role === "admin" ? ADMIN_LINKS : me ? USER_LINKS : [];

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10 print:hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link href={me?.role === "admin" ? "/" : "/welfare"} className="font-semibold text-lg tracking-tight text-gray-900">
          Project MARR
        </Link>
        <nav className="flex items-center gap-1 sm:gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              {link.label}
            </Link>
          ))}
          {me && (
            <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
              <span className="text-sm text-gray-600">
                {me.employee_name ?? me.username}
                <span className="ml-1 text-xs text-gray-400">({me.role})</span>
              </span>
              <Link href="/change-password" className="text-sm text-gray-600 underline">
                Password
              </Link>
              <button onClick={logout} className="text-sm font-medium text-red-600 hover:text-red-800">
                Logout
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
