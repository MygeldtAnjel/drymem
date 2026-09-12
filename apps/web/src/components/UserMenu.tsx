import { Check, LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";
import type { Me } from "@/api";
import { go } from "@/router";
import { readTheme, saveTheme, watchSystem, type Theme } from "@/theme";

/** Initials for the fallback, which is what everyone sees — there are no avatars. */
function initials(value: string): string {
  const parts = value.split(/[@\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match my system", icon: Monitor },
];

export function UserMenu({ me, onSignOut }: { me: Me | null; onSignOut: () => void }) {
  const name = me?.name || me?.email || "Signed in";
  // The class is already on `<html>` from the inline script; this only mirrors
  // the stored choice so the menu can tick the right row.
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Follow the machine, but only while the choice is "system".
  useEffect(() => watchSystem(theme, () => setTheme("system")), [theme]);

  const choose = (next: Theme) => {
    saveTheme(next);
    setTheme(next);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="size-6 rounded-md">
                <AvatarFallback className="rounded-md text-[10px]">
                  {initials(me?.email ?? "?")}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">{name}</span>
                {me?.name && (
                  <span className="truncate text-xs text-muted-foreground">{me.email}</span>
                )}
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {me?.email ?? "Not signed in"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => go("settings")}>
                <User /> Your profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go("settings")}>
                <Settings /> Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={value}
                  onSelect={(e) => {
                    // Keep the menu open: picking a theme is something people
                    // try twice before settling.
                    e.preventDefault();
                    choose(value);
                  }}
                >
                  <Icon /> {label}
                  {theme === value && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
