/**
 * AuthManager
 * Manages automatic authentication for the Clinical Extractor
 * Auto-registers/logs in a default user to enable seamless backend integration
 */

import BackendClient from './BackendClient';
import StatusManager from '../utils/status';

/**
 * Default user credentials - MUST be set via environment variables for security
 * VITE_DEFAULT_USER_EMAIL and VITE_DEFAULT_USER_PASSWORD must be defined in .env.local
 */
const DEFAULT_USER = {
  email: import.meta.env.VITE_DEFAULT_USER_EMAIL,
  password: import.meta.env.VITE_DEFAULT_USER_PASSWORD
};

class AuthManager {
  private initialized = false;

  async ensureAuthenticated(): Promise<boolean> {
    if (this.initialized && BackendClient.isAuthenticated()) {
      return true;
    }

    // Check if backend is available first
    const backendAvailable = await BackendClient.healthCheck().catch(() => false);
    if (!backendAvailable) {
      console.log('ℹ️ Backend not available - using frontend-only mode');
      this.initialized = true;
      return false; // Backend not available, but app can still work
    }

    // Validate environment variables are set
    if (!DEFAULT_USER.email || !DEFAULT_USER.password) {
      console.warn('⚠️ Backend credentials not configured (VITE_DEFAULT_USER_EMAIL/PASSWORD missing)');
      console.log('ℹ️ Continuing in frontend-only mode');
      this.initialized = true;
      return false; // Missing credentials, but app can still work
    }

    try {
      if (!BackendClient.isAuthenticated()) {
        try {
          await BackendClient.login(DEFAULT_USER.email, DEFAULT_USER.password);
          console.log('✅ Authenticated with backend');
        } catch (loginError: any) {
          // Prefer status code check, fallback to message if status is missing
          if ((loginError.status === 401) ||
              (loginError.response?.status === 401) ||
              (loginError.message && loginError.message.includes('Incorrect email or password'))) {
            await BackendClient.register(DEFAULT_USER.email, DEFAULT_USER.password);
            console.log('✅ Registered and authenticated with backend');
          } else {
            throw loginError;
          }
        }
      }

      this.initialized = true;
      return true;
    } catch (error: any) {
      console.warn('⚠️ Backend authentication failed - continuing in frontend-only mode:', error.message);
      // Don't show error to user - app works fine without backend
      this.initialized = true;
      return false; // Backend auth failed, but app can still work
    }
  }

  async initialize(): Promise<void> {
    await this.ensureAuthenticated();
  }
}

export default new AuthManager();
