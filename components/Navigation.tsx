"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrototype } from "@/lib/prototype-context";
import { GraduationCap, Menu, X } from "lucide-react";

export default function Navigation() {
  const pathname = usePathname();
  const { settings, isMounted } = usePrototype();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Task", href: "/task" },
    { name: "Chat", href: "/task/chat" },
    { name: "Controls", href: "/prototype-controls" },
  ];

  const statusColor = !isMounted
    ? "bg-green-500"
    : settings.serviceMode === "primary" || settings.serviceMode === "nvidia"
      ? "bg-green-500"
      : settings.serviceMode === "local"
        ? "bg-red-500"
        : "bg-yellow-500";

  return (
    <nav className="sticky top-0 z-50 border-b border-card-border bg-card-bg/80 backdrop-blur-md">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-4 h-14">
        {/* Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-primary font-bold text-lg"
        >
          <GraduationCap className="w-5 h-5" />
          StudyFlow
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                pathname === l.href || pathname?.startsWith(l.href + "/")
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {l.name}
            </Link>
          ))}
          <span
            className={`ml-3 w-2.5 h-2.5 rounded-full ${statusColor}`}
            title="AI Service Status"
          />
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 text-muted"
        >
          {mobileOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-card-border bg-card-bg px-4 pb-3 pt-2 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-3 py-2 rounded-md text-sm font-medium ${
                pathname === l.href || pathname?.startsWith(l.href + "/")
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
