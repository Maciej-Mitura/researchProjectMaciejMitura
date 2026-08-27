import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_PRIVACY_ACKNOWLEDGEMENTS,
  type PrivacyAcknowledgements,
} from '@/features/privacy/acknowledgements';
import {
  acknowledgeCameraPrivacy as persistCameraAck,
  acknowledgeExternalAi as persistExternalAiAck,
  loadPrivacyAcknowledgements,
  resetPrivacyAcknowledgements as persistReset,
} from '@/features/privacy/store';

type PrivacyAcknowledgementsValue = {
  ready: boolean;
  acknowledgements: PrivacyAcknowledgements;
  acknowledgeCameraPrivacy: () => Promise<void>;
  acknowledgeExternalAi: () => Promise<void>;
  resetAcknowledgements: () => Promise<void>;
};

const PrivacyAcknowledgementsContext = createContext<PrivacyAcknowledgementsValue | null>(null);

export function PrivacyAcknowledgementsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [acknowledgements, setAcknowledgements] = useState<PrivacyAcknowledgements>(
    DEFAULT_PRIVACY_ACKNOWLEDGEMENTS,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPrivacyAcknowledgements().then((state) => {
        setAcknowledgements(state);
        setReady(true);
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const acknowledgeCameraPrivacy = useCallback(async () => {
    const next = await persistCameraAck();
    setAcknowledgements(next);
  }, []);

  const acknowledgeExternalAi = useCallback(async () => {
    const next = await persistExternalAiAck();
    setAcknowledgements(next);
  }, []);

  const resetAcknowledgements = useCallback(async () => {
    const next = await persistReset();
    setAcknowledgements(next);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      acknowledgements,
      acknowledgeCameraPrivacy,
      acknowledgeExternalAi,
      resetAcknowledgements,
    }),
    [
      acknowledgements,
      acknowledgeCameraPrivacy,
      acknowledgeExternalAi,
      ready,
      resetAcknowledgements,
    ],
  );

  return (
    <PrivacyAcknowledgementsContext.Provider value={value}>
      {children}
    </PrivacyAcknowledgementsContext.Provider>
  );
}

export function usePrivacyAcknowledgements(): PrivacyAcknowledgementsValue {
  const value = useContext(PrivacyAcknowledgementsContext);
  if (!value) {
    throw new Error('usePrivacyAcknowledgements must be used within PrivacyAcknowledgementsProvider.');
  }
  return value;
}
