import { useState, useEffect, useCallback, useMemo } from 'react';

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  /** optional Urdu print name; empty falls back to name */
  nameUrdu: string;
  /** optional Urdu print address; empty falls back to address */
  addressUrdu: string;
  whatsapp: string;
  website: string;
  /** english print footer terms; empty hides the note block */
  printNote: string;
  /** urdu print footer terms; empty falls back to printNote */
  printNoteUrdu: string;
}

const COMPANY_PROFILE_KEYS = {
  name: 'companyProfile.name',
  address: 'companyProfile.address',
  phone: 'companyProfile.phone',
  email: 'companyProfile.email',
  nameUrdu: 'companyProfile.nameUrdu',
  addressUrdu: 'companyProfile.addressUrdu',
  whatsapp: 'companyProfile.whatsapp',
  website: 'companyProfile.website',
  printNote: 'companyProfile.printNote',
  printNoteUrdu: 'companyProfile.printNoteUrdu',
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
  nameUrdu: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.nameUrdu) ?? '',
  ).trim(),
  addressUrdu: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.addressUrdu) ?? '',
  ),
  whatsapp: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.whatsapp) ?? '',
  ).trim(),
  website: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.website) ?? '',
  ).trim(),
  printNote: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.printNote) ?? '',
  ),
  printNoteUrdu: String(
    window.electron.store.get(COMPANY_PROFILE_KEYS.printNoteUrdu) ?? '',
  ),
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
    window.electron.store.set(COMPANY_PROFILE_KEYS.nameUrdu, next.nameUrdu);
    window.electron.store.set(
      COMPANY_PROFILE_KEYS.addressUrdu,
      next.addressUrdu,
    );
    window.electron.store.set(COMPANY_PROFILE_KEYS.whatsapp, next.whatsapp);
    window.electron.store.set(COMPANY_PROFILE_KEYS.website, next.website);
    window.electron.store.set(COMPANY_PROFILE_KEYS.printNote, next.printNote);
    window.electron.store.set(
      COMPANY_PROFILE_KEYS.printNoteUrdu,
      next.printNoteUrdu,
    );
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
