"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import { usePlanner } from "@/components/planner/planner-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fr } from "@/lib/i18n/fr";
import type { ClosureFormState, TeamEditorState } from "@/lib/planner/types";
import { closureTypeOptions, getSortedTeams } from "@/lib/planner/types";

const DEFAULT_TEAM_ACCENT_COLOR = "#5a8fb0";
const DEFAULT_TEAM_SOFT_COLOR = "#e9f3f8";

function normalizeHexColor(value: string) {
  const trimmedValue = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
    return trimmedValue.toUpperCase();
  }

  const shortHexMatch = trimmedValue.match(/^#([0-9a-f]{3})$/i);
  if (!shortHexMatch) {
    return null;
  }

  const [red, green, blue] = shortHexMatch[1].split("");
  return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
}

function rgbStringToHex(value: string) {
  const match = value.match(
    /^rgba?\(\s*(\d{1,3})(?:\s*,|\s+)(\d{1,3})(?:\s*,|\s+)(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)$/i
  );
  if (!match) {
    return null;
  }

  const channels = match.slice(1, 4).map((channel) => Number(channel));
  if (channels.some((channel) => channel < 0 || channel > 255)) {
    return null;
  }

  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function resolvePickerColor(
  value: string,
  fallback: string,
  allowCssProbe = false
) {
  const hexValue = normalizeHexColor(value);
  if (hexValue) {
    return hexValue;
  }

  const rgbHexValue = rgbStringToHex(value);
  if (rgbHexValue) {
    return rgbHexValue;
  }

  if (!allowCssProbe || typeof document === "undefined") {
    return fallback;
  }

  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = value;
  if (!probe.style.color) {
    return fallback;
  }

  document.body.appendChild(probe);
  const computedColor = window.getComputedStyle(probe).color;
  probe.remove();

  return rgbStringToHex(computedColor) ?? fallback;
}

function normalizeTeamEditorState(
  values: TeamEditorState,
  allowCssProbe = false
): TeamEditorState {
  return {
    ...values,
    accentColor: resolvePickerColor(
      values.accentColor,
      DEFAULT_TEAM_ACCENT_COLOR,
      allowCssProbe
    ),
    softColor: resolvePickerColor(
      values.softColor,
      DEFAULT_TEAM_SOFT_COLOR,
      allowCssProbe
    ),
  };
}

function buildEmptyTeamState(displayOrder: number): TeamEditorState {
  return {
    nameFr: "",
    slug: "",
    accentColor: DEFAULT_TEAM_ACCENT_COLOR,
    softColor: DEFAULT_TEAM_SOFT_COLOR,
    displayOrder,
  };
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3 rounded-lg border border-input bg-background px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
        />
        <span className="font-mono text-sm text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

function TeamEditorCard({
  teamId,
  initialState,
  onSave,
  onDelete,
}: {
  teamId: string;
  initialState: TeamEditorState;
  onSave: (teamId: string, values: TeamEditorState) => void;
  onDelete: (teamId: string) => void;
}) {
  const [form, setForm] = useState(() => normalizeTeamEditorState(initialState));

  useEffect(() => {
    setForm(normalizeTeamEditorState(initialState, true));
  }, [initialState]);

  return (
    <Card className="border-border/60 bg-card/95">
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{fr.settings.fields.name}</Label>
            <Input
              value={form.nameFr}
              onChange={(event) =>
                setForm((current) => ({ ...current, nameFr: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{fr.settings.fields.slug}</Label>
            <Input
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{fr.settings.fields.order}</Label>
            <Input
              type="number"
              value={form.displayOrder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayOrder: Number(event.target.value) || 0,
                }))
              }
            />
          </div>
          <ColorField
            label={fr.settings.fields.accent}
            value={form.accentColor}
            onChange={(accentColor) =>
              setForm((current) => ({ ...current, accentColor }))
            }
          />
          <ColorField
            label={fr.settings.fields.soft}
            value={form.softColor}
            onChange={(softColor) => setForm((current) => ({ ...current, softColor }))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onSave(teamId, form)}>
            <Save className="size-4" />
            {fr.settings.saveTeam}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (window.confirm(fr.settings.deleteTeamConfirm)) {
                onDelete(teamId);
              }
            }}
          >
            <Trash2 className="size-4" />
            {fr.settings.deleteTeam}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPanel() {
  const {
    state,
    createTeam,
    updateTeam,
    deleteTeam,
    setHolidaySourceEnabled,
    addClosure,
    removeClosure,
  } = usePlanner();
  const teams = useMemo(() => getSortedTeams(state.teams), [state.teams]);
  const customClosures = useMemo(
    () => state.closures.filter((closure) => closure.source === "custom"),
    [state.closures]
  );
  const generatedFranceClosures = useMemo(
    () => state.closures.filter((closure) => closure.source === "fr-public-holiday"),
    [state.closures]
  );
  const [newTeam, setNewTeam] = useState<TeamEditorState>(() =>
    buildEmptyTeamState(teams.length)
  );
  const [newClosure, setNewClosure] = useState<ClosureFormState>({
    title: "",
    type: "company_closure",
    startDate: "",
    endDate: "",
  });

  return (
    <section className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {fr.settings.eyebrow}
        </p>
        <h2 className="font-heading text-3xl font-semibold text-foreground">
          {fr.settings.title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {fr.settings.description}
        </p>
      </div>

      <Card className="border-border/60 bg-card/95 shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="font-heading text-2xl">{fr.settings.teamsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {teams.map((team) => (
              <TeamEditorCard
                key={`${team.id}-${team.nameFr}-${team.displayOrder}-${team.accentColor}-${team.softColor}`}
                teamId={team.id}
                initialState={{
                  nameFr: team.nameFr,
                  slug: team.slug,
                  accentColor: team.accentColor,
                  softColor: team.softColor,
                  displayOrder: team.displayOrder,
                }}
                onSave={updateTeam}
                onDelete={deleteTeam}
              />
            ))}
          </div>

          <Card className="border-dashed border-border/80 bg-muted/20">
            <CardContent className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{fr.settings.fields.name}</Label>
                  <Input
                    value={newTeam.nameFr}
                    onChange={(event) =>
                      setNewTeam((current) => ({ ...current, nameFr: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{fr.settings.fields.slug}</Label>
                  <Input
                    value={newTeam.slug}
                    onChange={(event) =>
                      setNewTeam((current) => ({ ...current, slug: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{fr.settings.fields.order}</Label>
                  <Input
                    type="number"
                    value={newTeam.displayOrder}
                    onChange={(event) =>
                      setNewTeam((current) => ({
                        ...current,
                        displayOrder: Number(event.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <ColorField
                  label={fr.settings.fields.accent}
                  value={newTeam.accentColor}
                  onChange={(accentColor) =>
                    setNewTeam((current) => ({ ...current, accentColor }))
                  }
                />
                <ColorField
                  label={fr.settings.fields.soft}
                  value={newTeam.softColor}
                  onChange={(softColor) =>
                    setNewTeam((current) => ({ ...current, softColor }))
                  }
                />
              </div>

              <Button
                onClick={() => {
                  createTeam(newTeam);
                  setNewTeam(buildEmptyTeamState(teams.length + 1));
                }}
              >
                <Plus className="size-4" />
                {fr.settings.addTeam}
              </Button>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-border/60 bg-card/95 shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="font-heading text-2xl">
              {fr.settings.holidaySourcesTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {state.holidaySources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-2xl border border-border/60 p-4"
              >
                <div>
                  <p className="font-medium text-foreground">{source.labelFr}</p>
                  <p className="text-sm text-muted-foreground">{source.code}</p>
                </div>
                <Button
                  variant={source.enabled ? "default" : "outline"}
                  onClick={() => setHolidaySourceEnabled(source.code, !source.enabled)}
                >
                  {source.enabled ? "Actif" : "Inactif"}
                </Button>
              </div>
            ))}

            <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4">
              {generatedFranceClosures.map((closure) => (
                <div key={closure.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium text-foreground">{closure.title}</span>
                  <Badge variant="outline">{closure.startDate}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/95 shadow-[0_24px_52px_-42px_rgba(18,25,38,0.55)]">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="font-heading text-2xl">
              {fr.settings.customClosuresTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-3">
              {customClosures.map((closure) => (
                <div
                  key={closure.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 p-4"
                >
                  <div>
                    <p className="font-medium text-foreground">{closure.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {closure.startDate} {"->"} {closure.endDate}
                    </p>
                  </div>
                  <Button variant="destructive" onClick={() => removeClosure(closure.id)}>
                    <Trash2 className="size-4" />
                    {fr.settings.deleteClosure}
                  </Button>
                </div>
              ))}
            </div>

            <Card className="border-dashed border-border/80 bg-muted/20">
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{fr.settings.fields.label}</Label>
                    <Input
                      value={newClosure.title}
                      onChange={(event) =>
                        setNewClosure((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{fr.settings.fields.type}</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={newClosure.type}
                      onChange={(event) =>
                        setNewClosure((current) => ({
                          ...current,
                          type: event.target.value as ClosureFormState["type"],
                        }))
                      }
                    >
                      {closureTypeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.labelFr}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>{fr.settings.fields.startDate}</Label>
                    <Input
                      type="date"
                      value={newClosure.startDate}
                      onChange={(event) =>
                        setNewClosure((current) => ({
                          ...current,
                          startDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{fr.settings.fields.endDate}</Label>
                    <Input
                      type="date"
                      value={newClosure.endDate}
                      onChange={(event) =>
                        setNewClosure((current) => ({
                          ...current,
                          endDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <Button
                  onClick={() => {
                    addClosure(newClosure);
                    setNewClosure({
                      title: "",
                      type: "company_closure",
                      startDate: "",
                      endDate: "",
                    });
                  }}
                >
                  <Plus className="size-4" />
                  {fr.settings.addClosure}
                </Button>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
