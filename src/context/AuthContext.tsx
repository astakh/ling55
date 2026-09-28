import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, LanguageProfile } from '../types';
import { apiRequest, setAccessToken } from '../api/client';

interface AuthContextType {
  user: User | null;
  activeProfile: LanguageProfile | null;
  profiles: LanguageProfile[];
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadUser: () => Promise<void>;
  reloadProfiles: () => Promise<void>;
  switchLanguage: (profileId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<LanguageProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<LanguageProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reloadProfiles = async () => {
    try {
      const res = await apiRequest<{ profiles: LanguageProfile[] }>('/language-profiles');
      setProfiles(res.profiles || []);
      const active = res.profiles.find(p => p.is_active) || res.profiles[0] || null;
      setActiveProfile(active);
    } catch (err) {
      console.error('Error fetching language profiles:', err);
    }
  };

  const reloadUser = async () => {
    try {
      const res = await apiRequest<{ user: User }>('/auth/me');
      setUser(res.user);
      if (res.user.is_onboarded) {
        await reloadProfiles();
      }
    } catch (err) {
      setUser(null);
      setProfiles([]);
      setActiveProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    reloadUser();

    const handleLogout = () => {
      setUser(null);
      setProfiles([]);
      setActiveProfile(null);
    };

    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass }),
    });
    setAccessToken(res.access_token);
    setUser(res.user);
    if (res.user.is_onboarded) {
      await reloadProfiles();
    }
  };

  const register = async (email: string, pass: string) => {
    const res = await apiRequest<{ access_token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass }),
    });
    setAccessToken(res.access_token);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (e) {
      // Ignore
    }
    setAccessToken(null);
    setUser(null);
    setProfiles([]);
    setActiveProfile(null);
  };

  const switchLanguage = async (profileId: string) => {
    await apiRequest('/me/active-language', {
      method: 'PUT',
      body: JSON.stringify({ language_profile_id: profileId }),
    });
    if (user) {
      setUser({ ...user, active_language_profile_id: profileId });
    }
    await reloadProfiles();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        activeProfile,
        profiles,
        isLoading,
        login,
        register,
        logout,
        reloadUser,
        reloadProfiles,
        switchLanguage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
