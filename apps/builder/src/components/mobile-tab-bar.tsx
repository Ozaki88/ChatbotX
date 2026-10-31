"use client"

import { useSidebar } from "@chatbotx.io/ui/components/ui/sidebar"
import { cn } from "@chatbotx.io/ui/lib/utils"
import {
  AtomIcon,
  BarChart3Icon,
  InstagramIcon,
  MenuIcon,
  MessageCircleMoreIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * Phone navigation: the four places Freya's day happens, plus the full menu.
 * Rendered below `md` only, as a row in the shell's flex column (never fixed),
 * so a full-bleed page like the inbox keeps its composer above it.
 */
export function MobileTabBar({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const base = `/space/${workspaceId}`
  const tabs = [
    { label: "Stats", href: `${base}/dashboard/freya-stats`, icon: BarChart3Icon },
    { label: "Inbox", href: `${base}/inbox`, icon: MessageCircleMoreIcon },
    { label: "Comments", href: `${base}/ig-comments`, icon: InstagramIcon },
    { label: "Keywords", href: `${base}/automated-responses`, icon: AtomIcon },
  ]
  const itemClass =
    "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] leading-none"

  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href)
        return (
          <Link
            className={cn(
              itemClass,
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
            href={tab.href}
            key={tab.href}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </Link>
        )
      })}
      <button
        className={cn(itemClass, "text-muted-foreground")}
        onClick={() => setOpenMobile(true)}
        type="button"
      >
        <MenuIcon className="size-5" />
        Menu
      </button>
    </nav>
  )
}
