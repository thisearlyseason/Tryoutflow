import { NativeModules } from 'react-native';

// Only the default, non-biometric SecureStore contract is used by this app.
// Keep its native storage identities and wire format for installed-user continuity.
type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};
function store(): Store {
  const value = NativeModules.TryOutSecureStore as Store | undefined;
  if (!value) throw new Error('Secure storage is unavailable.');
  return value;
}
export const getItemAsync = (key: string) => store().getItem(key);
export const setItemAsync = (key: string, value: string) => store().setItem(key, value);
export const deleteItemAsync = (key: string) => store().deleteItem(key);
