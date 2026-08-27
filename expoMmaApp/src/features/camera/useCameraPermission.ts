import { type PermissionResponse } from 'expo';
import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

export type CameraPermissionState =
  | 'loading'
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'blocked';

function mapPermission(permission: PermissionResponse | null): CameraPermissionState {
  if (!permission) {
    return 'loading';
  }

  if (permission.granted) {
    return 'granted';
  }

  if (permission.status === 'undetermined') {
    return 'undetermined';
  }

  if (permission.canAskAgain) {
    return 'denied';
  }

  return 'blocked';
}

export function useCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();

  return {
    state: mapPermission(permission),
    permission,
    requestPermission,
    openSettings: () => Linking.openSettings(),
  };
}
