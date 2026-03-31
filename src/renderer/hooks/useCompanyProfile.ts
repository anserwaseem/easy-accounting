import { useCallback, useEffect, useMemo, useState } from 'react';

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
}

const COMPANY_PROFILE_KEYS = {
  name: 'companyProfile.name',
  address: 'companyProfile.address',
  phone: 'companyProfile.phone',
  email: 'companyProfile.email',
} as const;

const readCompanyProfile = (): CompanyProfile => ({
  name: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.name) ?? '',
  ).trim(),
  address: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.address) ?? '',
  ),
  phone: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.phone) ?? '',
  ).trim(),
  email: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.email) ?? '',
  ).trim(),
});

export const useCompanyProfile = () => {
  const [profile, setProfile] = useState<CompanyProfile>(() =>
    readCompanyProfile(),
  );

  useEffect(() => {
    setProfile(readCompanyProfile());
  }, []);

  const saveCompanyProfile = useCallback((next: CompanyProfile) => {
    window.electron.store.set(COMPANY_PROFILE_KEYS.name, next.name);
    window.electron.store.set(COMPANY_PROFILE_KEYS.address, next.address);
    window.electron.store.set(COMPANY_PROFILE_KEYS.phone, next.phone);
    window.electron.store.set(COMPANY_PROFILE_KEYS.email, next.email);
    setProfile(next);
  }, []);

  return useMemo(
    () => ({
      profile,
      saveCompanyProfile,
    }),
    [profile, saveCompanyProfile],
  );
};
