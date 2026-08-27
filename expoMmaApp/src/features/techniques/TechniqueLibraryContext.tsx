import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { AnalysisClientError } from '@/features/analysis/api/errors';
import { fetchRecordedTechniques } from '@/features/reference/api/client';
import { ReferenceClientError } from '@/features/reference/api/errors';
import { getBuiltinTechniques } from '@/features/techniques/catalog';
import { mergeTechniqueLibrary, recordedSummaryToTechnique } from '@/features/techniques/library';
import type { Technique } from '@/features/techniques/types';

type TechniqueLibraryValue = {
  techniques: Technique[];
  loading: boolean;
  libraryWarning: string | null;
  libraryNotice: string | null;
  refresh: () => Promise<void>;
  getById: (id: string) => Technique | undefined;
  upsertRecorded: (technique: Technique) => void;
  removeRecorded: (id: string) => void;
  setLibraryNotice: (message: string | null) => void;
};

const TechniqueLibraryContext = createContext<TechniqueLibraryValue | null>(null);

export function TechniqueLibraryProvider({ children }: { children: ReactNode }) {
  const [recorded, setRecorded] = useState<Technique[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryWarning, setLibraryWarning] = useState<string | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const summaries = await fetchRecordedTechniques();
      setRecorded(summaries.map(recordedSummaryToTechnique));
      setLibraryWarning(null);
    } catch (error) {
      const message =
        error instanceof ReferenceClientError || error instanceof AnalysisClientError
          ? error.message
          : 'Recorded techniques could not be loaded. Built-in techniques are still available.';
      setLibraryWarning(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const upsertRecorded = useCallback((technique: Technique) => {
    setRecorded((current) => [technique, ...current.filter((item) => item.id !== technique.id)]);
  }, []);

  const removeRecorded = useCallback((id: string) => {
    setRecorded((current) => current.filter((item) => item.id !== id && item.slug !== id));
  }, []);

  const techniques = useMemo(
    () => mergeTechniqueLibrary(getBuiltinTechniques(), recorded),
    [recorded],
  );

  const getById = useCallback(
    (id: string) => techniques.find((technique) => technique.id === id || technique.slug === id),
    [techniques],
  );

  const value = useMemo(
    () => ({
      techniques,
      loading,
      libraryWarning,
      libraryNotice,
      refresh,
      getById,
      upsertRecorded,
      removeRecorded,
      setLibraryNotice,
    }),
    [techniques, loading, libraryWarning, libraryNotice, refresh, getById, upsertRecorded, removeRecorded],
  );

  return (
    <TechniqueLibraryContext.Provider value={value}>{children}</TechniqueLibraryContext.Provider>
  );
}

export function useTechniqueLibrary(): TechniqueLibraryValue {
  const value = useContext(TechniqueLibraryContext);
  if (!value) {
    throw new Error('useTechniqueLibrary must be used within TechniqueLibraryProvider.');
  }
  return value;
}
