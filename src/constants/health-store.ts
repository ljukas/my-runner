import { Platform } from 'react-native';

/** The platform health store's name, as the app writes it in copy. */
export const HEALTH_STORE = Platform.select({ android: 'Health Connect', default: 'Apple Health' });
