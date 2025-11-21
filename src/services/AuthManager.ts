/**
 * AuthManager
 * Manages automatic authentication for the Clinical Extractor
 * Auto-registers/logs in a default user to enable seamless backend integration
 */

import BackendClient from './BackendClient';
import StatusManager from '../utils/status';

/**
 * Default demo user credentials (auto-created by backend on startup)
 * No configuration required - works out of the box!
 */
const DEFAULT_USER = {
  email: 'demo@example.com',
  password: 'demo123'
};

class AuthManager {
  private initialized = false;

  async ensureAuthenticated(): Promise<boolean> {
    if (this.initialized && BackendClient.isAuthenticated()) {
      return true;
    }

    // Check if backend is available first with retry (longer delays for startup)
    let backendAvailable = false;
    const maxAttempts = 5;
    const retryDelays = [500, 1000, 1500, 2000, 2500]; // Progressive backoff
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`🔍 Checking backend health (attempt ${attempt + 1}/${maxAttempts})...`);
        backendAvailable = await BackendClient.healthCheck();
        if (backendAvailable) {
          console.log('✅ Backend is available');
          break;
        }
      } catch (err) {
        console.log(`⚠️ Health check attempt ${attempt + 1} failed:`, err);
      }
      
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
      }
    }

    if (!backendAvailable) {
      console.log('ℹ️ Backend not available after multiple attempts - using frontend-only mode');
      this.initialized = true;
      return false;
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
