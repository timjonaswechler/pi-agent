// ============================================
// TUI SELECT DIALOGS
// ============================================

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Text, SelectList, Container } from "@mariozechner/pi-tui";

export async function showAgentSelect(
  _api: ExtensionAPI,
  ctx: ExtensionCommandContext,
  agents: string[],
): Promise<string | null> {
  const items = agents.map((a) => ({ label: a, value: a }));

  return new Promise((resolve) => {
    ctx.ui
      .custom<string | null>((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", "Select Agent:"), 1, 1));

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
        });
        selectList.onSelect = (item) => done(item?.value ?? null);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
            1,
            0,
          ),
        );

        return {
          render: (width: number) => container.render(width),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      })
      .then(resolve)
      .catch(() => resolve(null));
  });
}

export async function showTeamSelect(
  _api: ExtensionAPI,
  ctx: ExtensionCommandContext,
  teams: { label: string; value: string }[],
): Promise<string | null> {
  return new Promise((resolve) => {
    ctx.ui
      .custom<string | null>((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", "Select Team:"), 1, 1));

        const selectList = new SelectList(teams, Math.min(teams.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
        });
        selectList.onSelect = (item) => done(item?.value ?? null);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
            1,
            0,
          ),
        );

        return {
          render: (width: number) => container.render(width),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      })
      .then(resolve)
      .catch(() => resolve(null));
  });
}
