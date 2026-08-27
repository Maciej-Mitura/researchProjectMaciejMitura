import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { AnalysisClientError } from '@/features/analysis/api/errors';
import { getLatestComparison, setLatestComparison } from '@/features/comparison/latestComparison';
import { techniqueSupportsGenericComparison } from '@/features/techniques/catalog';
import { useTechniqueLibrary } from '@/features/techniques/TechniqueLibraryContext';
import type { Technique } from '@/features/techniques/types';
import {
  requestDeterministicRepeat,
  requestSelfComparison,
} from '@/features/validation/api';
import {
  ADVANCED_TOOLS_DEFAULT_EXPANDED,
  noteFieldForTest,
  PRIMARY_VALIDATION_TESTS,
  scenarioForPrimaryTest,
  type DeliberateSeverity,
  type PrimaryValidationTest,
  type PrimaryValidationTestId,
} from '@/features/validation/presentation';
import { setValidationSession } from '@/features/validation/session';
import { spacing } from '@/theme/spacing';
import { useAppTheme } from '@/theme/useAppTheme';
import { getReadyHref, validationResultHref, validationSummaryHref } from '@/utils/routes';

export function ValidationScreen() {
  const { techniques, loading } = useTechniqueLibrary();
  const recorded = useMemo(
    () => techniques.filter((item) => techniqueSupportsGenericComparison(item)),
    [techniques],
  );
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState<PrimaryValidationTestId | null>(null);
  const [severity, setSeverity] = useState<DeliberateSeverity>('small');
  const [advancedOpen, setAdvancedOpen] = useState(ADVANCED_TOOLS_DEFAULT_EXPANDED);
  const [customNotes, setCustomNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedTechniqueId = techniqueId ?? recorded[0]?.id ?? null;
  const technique = recorded.find((item) => item.id === selectedTechniqueId || item.slug === selectedTechniqueId);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      const client =
        caught instanceof AnalysisClientError ? caught : new AnalysisClientError('validation_failed', String(caught));
      setError(client.message);
    } finally {
      setBusy(null);
    }
  }

  function beginRecording(testId: PrimaryValidationTestId, noteValue: string) {
    if (!technique) {
      return;
    }
    setValidationSession({
      techniqueId: technique.id,
      techniqueSlug: technique.slug,
      techniqueName: technique.name,
      scenarioType: scenarioForPrimaryTest(testId, severity),
      notes: noteValue.trim() ? noteValue.trim() : null,
      source: 'recording',
      deterministicRepeat: null,
    });
    router.push(getReadyHref(technique.id));
  }

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title">Test how the analysis behaves</AppText>
        <AppText variant="body" tone="muted">
          Choose a technique and run a controlled test. Use this screen to demonstrate that similar
          movements score highly, deliberate differences lower the score, and poor recordings are
          rejected.
        </AppText>
        <AppText variant="caption" tone="muted">
          Research tool — not part of normal training.
        </AppText>
      </View>

      <Card>
        <AppText variant="caption">1. Choose technique</AppText>
        {loading ? (
          <AppText variant="body" tone="muted">
            Loading techniques…
          </AppText>
        ) : null}
        {recorded.length === 0 && !loading ? (
          <AppText variant="body" tone="muted">
            Record a human reference technique first. Built-in catalog entries without a recorded
            reference cannot be used here.
          </AppText>
        ) : (
          <TechniquePicker
            techniques={recorded}
            selectedId={technique?.id ?? null}
            onSelect={setTechniqueId}
          />
        )}
        <AppText variant="body" tone="muted">
          The recorded reference for this technique will be used for the test.
        </AppText>
      </Card>

      <View style={styles.section}>
        <AppText variant="caption">2. Choose a test</AppText>
        {PRIMARY_VALIDATION_TESTS.map((test) => (
          <TestCard
            key={test.id}
            test={test}
            selected={selectedTest === test.id}
            disabled={!technique || busy != null}
            busy={busy}
            severity={severity}
            onSelect={() => setSelectedTest(test.id)}
            onSeverity={setSeverity}
            onRunSelf={() => {
              if (!technique) {
                return;
              }
              void run('self', async () => {
                const result = await requestSelfComparison(technique.slug);
                setLatestComparison({
                  techniqueId: technique.id,
                  attemptVideoUri: '',
                  response: result.comparison,
                  receivedAtMs: Date.now(),
                });
                setValidationSession({
                  techniqueId: technique.id,
                  techniqueSlug: technique.slug,
                  techniqueName: technique.name,
                  scenarioType: 'self_comparison',
                  notes: null,
                  source: 'self_test',
                  deterministicRepeat: result.deterministicRepeat,
                });
                router.push(validationResultHref);
              });
            }}
            onRecord={(noteValue) => beginRecording(test.id, noteValue)}
          />
        ))}
      </View>

      <Button label="View saved results" variant="secondary" onPress={() => router.push(validationSummaryHref)} />

      <Pressable
        accessibilityRole="button"
        onPress={() => setAdvancedOpen((value) => !value)}
        style={styles.advancedToggle}>
        <AppText variant="bodyStrong" tone="accent">
          {advancedOpen ? 'Hide advanced research tools' : 'Advanced research tools'}
        </AppText>
      </Pressable>

      {advancedOpen ? (
        <AdvancedTools
          technique={technique}
          selectedTest={selectedTest}
          severity={severity}
          customNotes={customNotes}
          busy={busy}
          onCustomNotes={setCustomNotes}
          onRepeat={() => {
            if (!technique) {
              return;
            }
            void run('repeat', async () => {
              const result = await requestDeterministicRepeat(technique.slug);
              setNotice(result.deterministicRepeat.label);
            });
          }}
          onLatestQuick={() => {
            if (!technique) {
              return;
            }
            const latest = getLatestComparison();
            if (!latest || latest.techniqueId !== technique.id) {
              setError('There is no latest Quick attempt for this technique yet.');
              return;
            }
            const testId = selectedTest ?? 'clean';
            setLatestComparison(latest);
            setValidationSession({
              techniqueId: technique.id,
              techniqueSlug: technique.slug,
              techniqueName: technique.name,
              scenarioType: selectedTest
                ? scenarioForPrimaryTest(testId, severity)
                : 'custom',
              notes: customNotes.trim() || null,
              source: 'latest_quick',
              deterministicRepeat: null,
            });
            router.push(validationResultHref);
          }}
          onRecordCustom={() => {
            if (!technique) {
              return;
            }
            setValidationSession({
              techniqueId: technique.id,
              techniqueSlug: technique.slug,
              techniqueName: technique.name,
              scenarioType: 'custom',
              notes: customNotes.trim() || null,
              source: 'custom',
              deterministicRepeat: null,
            });
            router.push(getReadyHref(technique.id));
          }}
        />
      ) : null}

      {notice ? (
        <AppText variant="body" tone="success">
          {notice}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="body" tone="warning">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

function TechniquePicker({
  techniques,
  selectedId,
  onSelect,
}: {
  techniques: Technique[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = techniques.find((item) => item.id === selectedId);

  return (
    <View style={styles.pickerWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Technique selector, ${selected?.name ?? 'none selected'}`}
        onPress={() => setOpen((value) => !value)}
        style={[styles.picker, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
        <AppText variant="bodyStrong">{selected?.name ?? 'Select a technique'}</AppText>
        <AppText variant="body" tone="muted">
          {open ? '▲' : '▼'}
        </AppText>
      </Pressable>
      {open
        ? techniques.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              style={[
                styles.pickerOption,
                {
                  borderColor: selectedId === item.id ? theme.accent : theme.border,
                  backgroundColor: theme.surface,
                },
              ]}>
              <AppText variant="body">{item.name}</AppText>
            </Pressable>
          ))
        : null}
    </View>
  );
}

function TestCard({
  test,
  selected,
  disabled,
  busy,
  severity,
  onSelect,
  onSeverity,
  onRunSelf,
  onRecord,
}: {
  test: PrimaryValidationTest;
  selected: boolean;
  disabled: boolean;
  busy: string | null;
  severity: DeliberateSeverity;
  onSelect: () => void;
  onSeverity: (value: DeliberateSeverity) => void;
  onRunSelf: () => void;
  onRecord: (noteValue: string) => void;
}) {
  const theme = useAppTheme();
  const [notes, setNotes] = useState('');
  const [cleanNoteOpen, setCleanNoteOpen] = useState(false);
  const note = noteFieldForTest(test.id);
  const showNote = selected && note && (test.id !== 'clean' || cleanNoteOpen);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onSelect}
      style={[
        styles.testCard,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: theme.surface,
        },
      ]}>
      <AppText variant="bodyStrong">{test.title}</AppText>
      <AppText variant="body" tone="muted">
        {test.description}
      </AppText>
      {test.badge ? (
        <AppText variant="caption" tone="accent">
          {test.badge}
        </AppText>
      ) : null}

      {selected && test.id === 'deliberate' ? (
        <View style={styles.severityWrap}>
          <AppText variant="caption">How different should it be?</AppText>
          <View style={styles.severityRow}>
            <SeverityChip
              label="Small difference"
              selected={severity === 'small'}
              onPress={() => onSeverity('small')}
            />
            <SeverityChip
              label="Major difference"
              selected={severity === 'major'}
              onPress={() => onSeverity('major')}
            />
          </View>
        </View>
      ) : null}

      {selected && test.id === 'clean' && note ? (
        <Pressable accessibilityRole="button" onPress={() => setCleanNoteOpen((value) => !value)}>
          <AppText variant="bodyStrong" tone="accent">
            {cleanNoteOpen ? 'Hide note' : note.label}
          </AppText>
        </Pressable>
      ) : null}

      {showNote && note ? (
        <TextField
          label={note.label}
          placeholder={note.placeholder}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      ) : null}

      {test.id === 'self_test' ? (
        <Button
          label={busy === 'self' ? 'Running…' : test.cta}
          disabled={disabled}
          onPress={() => {
            onSelect();
            onRunSelf();
          }}
        />
      ) : (
        <Button
          label={test.cta}
          disabled={disabled}
          onPress={() => {
            onSelect();
            onRecord(notes);
          }}
        />
      )}
    </Pressable>
  );
}

function SeverityChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.surfaceMuted : theme.surface,
        },
      ]}>
      <AppText variant="body">{label}</AppText>
    </Pressable>
  );
}

function AdvancedTools({
  technique,
  selectedTest,
  severity,
  customNotes,
  busy,
  onCustomNotes,
  onRepeat,
  onLatestQuick,
  onRecordCustom,
}: {
  technique: Technique | undefined;
  selectedTest: PrimaryValidationTestId | null;
  severity: DeliberateSeverity;
  customNotes: string;
  busy: string | null;
  onCustomNotes: (value: string) => void;
  onRepeat: () => void;
  onLatestQuick: () => void;
  onRecordCustom: () => void;
}) {
  const latest = technique ? getLatestComparison() : null;
  const latestReady = Boolean(latest && latest.techniqueId === technique?.id);

  return (
    <Card>
      <AppText variant="caption">Research instrumentation</AppText>
      <AppText variant="bodyStrong">Deterministic repeat check</AppText>
      <AppText variant="body" tone="muted">
        Runs the same Quick analysis again to verify that identical input produces the same result.
      </AppText>
      <Button
        label={busy === 'repeat' ? 'Checking…' : 'Run deterministic repeat check'}
        variant="secondary"
        disabled={!technique || busy != null}
        onPress={onRepeat}
      />

      <AppText variant="bodyStrong">Use latest Quick attempt</AppText>
      <AppText variant="body" tone="muted">
        {selectedTest
          ? `Attaches the latest Quick Comparison to the ${PRIMARY_VALIDATION_TESTS.find((item) => item.id === selectedTest)?.title ?? 'selected'} test${selectedTest === 'deliberate' ? ` (${severity})` : ''}.`
          : 'No test is selected above, so this will be saved as a custom result.'}
      </AppText>
      <Button
        label="Use latest Quick attempt"
        variant="secondary"
        disabled={!technique || busy != null || !latestReady}
        onPress={onLatestQuick}
      />

      <AppText variant="bodyStrong">Custom scenario</AppText>
      <AppText variant="body" tone="muted">
        Record an attempt that does not fit the four presentation tests. The selected technique is
        still the reference.
      </AppText>
      <TextField
        label="Custom note"
        placeholder="What is this custom check for?"
        value={customNotes}
        onChangeText={onCustomNotes}
        multiline
      />
      <Button
        label="Record custom attempt"
        variant="secondary"
        disabled={!technique || busy != null}
        onPress={onRecordCustom}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  pickerWrap: {
    gap: spacing.sm,
  },
  picker: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerOption: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  testCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  severityWrap: {
    gap: spacing.sm,
  },
  severityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  chip: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  advancedToggle: {
    minHeight: 44,
    justifyContent: 'center',
  },
});
