import { useState, useEffect, useCallback, useMemo } from 'react';
import { COMPANY_PROFILE_SETTING_KEYS as KEYS } from '@/core/services/businessSettingKeys';

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

const EMPTY_PROFILE: CompanyProfile = {
  name: '',
  address: '',
  phone: '',
  email: '',
  nameUrdu: '',
  addressUrdu: '',
  whatsapp: '',
  website: '',
  printNote: '',
  printNoteUrdu: '',
};

const SYNC_APPLIED_EVENT = 'easyaccounting:sync-applied';

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
};

const readCompanyProfile = async (): Promise<CompanyProfile> => {
  if (!window.electron.getSetting) return EMPTY_PROFILE;
  const [
    name,
    address,
    phone,
    email,
    nameUrdu,
    addressUrdu,
    whatsapp,
    website,
    printNote,
    printNoteUrdu,
  ] = await Promise.all([
    window.electron.getSetting(KEYS.name),
    window.electron.getSetting(KEYS.address),
    window.electron.getSetting(KEYS.phone),
    window.electron.getSetting(KEYS.email),
    window.electron.getSetting(KEYS.nameUrdu),
    window.electron.getSetting(KEYS.addressUrdu),
    window.electron.getSetting(KEYS.whatsapp),
    window.electron.getSetting(KEYS.website),
    window.electron.getSetting(KEYS.printNote),
    window.electron.getSetting(KEYS.printNoteUrdu),
  ]);
  return {
    name: asString(name).trim(),
    address: asString(address),
    phone: asString(phone).trim(),
    email: asString(email).trim(),
    nameUrdu: asString(nameUrdu).trim(),
    addressUrdu: asString(addressUrdu),
    whatsapp: asString(whatsapp).trim(),
    website: asString(website).trim(),
    printNote: asString(printNote),
    printNoteUrdu: asString(printNoteUrdu),
  };
};

export const useCompanyProfile = () => {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);

  const refresh = useCallback(async () => {
    setProfile(await readCompanyProfile());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(SYNC_APPLIED_EVENT, refresh);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, refresh);
  }, [refresh]);

  const saveCompanyProfile = useCallback(async (next: CompanyProfile) => {
    if (!window.electron.setSetting) return;
    await Promise.all([
      window.electron.setSetting(KEYS.name, next.name),
      window.electron.setSetting(KEYS.address, next.address),
      window.electron.setSetting(KEYS.phone, next.phone),
      window.electron.setSetting(KEYS.email, next.email),
      window.electron.setSetting(KEYS.nameUrdu, next.nameUrdu),
      window.electron.setSetting(KEYS.addressUrdu, next.addressUrdu),
      window.electron.setSetting(KEYS.whatsapp, next.whatsapp),
      window.electron.setSetting(KEYS.website, next.website),
      window.electron.setSetting(KEYS.printNote, next.printNote),
      window.electron.setSetting(KEYS.printNoteUrdu, next.printNoteUrdu),
    ]);
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
