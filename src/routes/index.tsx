import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "REUNUSA 2026" },
      { name: "description", content: "Reuni Akbar Alumni Husnul Khotimah dan e-ticket REUNUSA 2026." },
      { property: "og:title", content: "REUNUSA 2026" },
      { property: "og:description", content: "Reuni Akbar Alumni Husnul Khotimah dan e-ticket REUNUSA 2026." },
    ],
  }),
  component: RedirectToRegister,
});

function RedirectToRegister() {
  useEffect(() => {
    window.location.replace("/register.html");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">
      Membuka REUNUSA 2026…{" "}
      <a className="ml-1 underline" href="/register.html">
        Klik di sini bila tidak otomatis.
      </a>
    </div>
  );
}
