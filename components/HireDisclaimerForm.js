// components/HireDisclaimerForm.js – Web-only Equipment Hire Lease Disclaimer form
// Used in dashboard web pane when view=hire. Date picker (04 March 2026), Google Places address.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DatePickerModal, TimePickerModal } from 'react-native-paper-dates';
import { API_BASE_URL } from '../inventory-api/apiBase';
import { Colors, Radius, Shadows, sf } from '../constants/uiTheme';
import { formatDisplayDateLong } from '../utils/date';
import logger from '../utils/logger';
import {
  ALGOLIA_INDEX_CLIENTS,
  ALGOLIA_INDEX_PROJECTS,
  algoliaHitDisplay,
  algoliaQuery,
} from '../config/algolia';

const defaultRatePeriod = 'day';

function toISO(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTime(str) {
  if (!str || typeof str !== 'string') return { hours: 9, minutes: 0 };
  const [h, m] = str.trim().split(':').map(Number);
  const hours = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 9;
  const minutes = Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0;
  return { hours, minutes };
}

function formatTime(hours, minutes) {
  const h = Math.max(0, Math.min(23, Number(hours) || 0));
  const m = Math.max(0, Math.min(59, Number(minutes) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateForm(form, addressQuery) {
  const errs = {};
  const addr = (form.address || addressQuery || '').trim();
  if (!addr) errs.address = 'Address is required';
  const phone = (form.phone || '').trim();
  if (!phone) errs.phone = 'Contact number is required';
  const email = (form.email || '').trim();
  if (!email) errs.email = 'Email is required';
  else if (!EMAIL_REGEX.test(email)) errs.email = 'Please enter a valid email address';
  const startDate = (form.hireStartDate || '').trim();
  const endDate = (form.hireEndDate || '').trim();
  if (startDate && endDate && startDate > endDate) {
    errs.hirePeriod = 'Start date cannot be after return date';
  }
  return errs;
}

function normalizeRatePeriodUi(raw) {
  const s = String(raw || 'day').toLowerCase();
  if (s === 'week' || s === 'weekly') return 'week';
  if (s === 'month' || s === 'monthly') return 'month';
  return 'day';
}

export default function HireDisclaimerForm({ onGenerated, initialHire, hireFormMode = 'new' }) {
  const [generating, setGenerating] = useState(false);
  const [sharingSig, setSharingSig] = useState(false);
  const [docusignEnabled, setDocusignEnabled] = useState(false);
  const [datePicker, setDatePicker] = useState({ open: false, field: null });
  const [timePicker, setTimePicker] = useState({ open: false, field: null });
  const [form, setForm] = useState({
    hirerName: '',
    /** 'company' | 'project' | '' — user may only fill one; UI enforces mutual exclusion */
    entityOrProject: '',
    companyEntity: '',
    project: '',
    address: '',
    phone: '',
    email: '',
    // Current in-progress equipment line
    equipmentDescription: '',
    assetId: '',
    hireStartDate: '',
    hireStartTime: '',
    hireEndDate: '',
    rate: '',
    /** 'day' | 'week' | 'month' */
    ratePeriod: defaultRatePeriod,
  });

  // Address autocomplete (Google Places via API)
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressSuggestEnabled, setAddressSuggestEnabled] = useState(true);
  const suppressNextSuggestions = useRef(false);

  // Asset search (by asset / serial id)
  const [assetQuery, setAssetQuery] = useState('');
  const [assetSuggestions, setAssetSuggestions] = useState([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const assetsCacheRef = useRef([]);
  const suppressNextAssetSuggestions = useRef(false);

  // List of added equipment items for the document
  const [equipmentItems, setEquipmentItems] = useState([]);

  // Validation errors (key -> message)
  const [errors, setErrors] = useState({});

  // Hire conflict modal — populated when a 409 conflict is returned by the API
  const [conflictInfo, setConflictInfo] = useState(null);

  const isEditingExisting = hireFormMode === 'edit' && !!initialHire?.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/hire-disclaimer/docusign/status`);
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && j.enabled) setDocusignEnabled(true);
      } catch (e) {
        logger.warn('HireDisclaimerForm: DocuSign status check failed', e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-populate equipment fields from a scanned asset (new hire, no existing id)
  useEffect(() => {
    if (hireFormMode !== 'new') return;
    if (!initialHire?.data) return;
    const d = initialHire.data;
    const rawItems = Array.isArray(d.equipmentItems) ? d.equipmentItems : [];
    const items =
      rawItems.length > 0
        ? rawItems.map((it) => ({
            assetId: String(it.assetId || '').trim(),
            description: String(it.description || '').trim(),
          }))
        : d.assetId
          ? [{ assetId: String(d.assetId).trim(), description: String(d.equipmentDescription || '').trim() }]
          : [];
    const filtered = items.filter((it) => it.assetId || it.description);
    if (filtered.length > 0) setEquipmentItems(filtered);
    setErrors({});
  }, [initialHire, hireFormMode]);

  // Prefill when editing or copying an existing hire from the dashboard
  useEffect(() => {
    if (!initialHire?.id) return;
    if (hireFormMode !== 'edit' && hireFormMode !== 'copy') return;
    const d = initialHire.data || {};
    const company = String(d.companyEntity || initialHire.client || '').trim();
    const proj = String(d.project || initialHire.project || '').trim();
    let entityOrProject = '';
    if (company) entityOrProject = 'company';
    else if (proj) entityOrProject = 'project';
    const rawItems = Array.isArray(d.equipmentItems) ? d.equipmentItems : [];
    const items =
      rawItems.length > 0
        ? rawItems.map((it) => ({
            assetId: String(it.assetId || it.id || '').trim(),
            description: String(it.description || '').trim(),
          }))
        : (initialHire.serial || d.assetId)
          ? [
              {
                assetId: String(initialHire.serial || d.assetId || '').trim(),
                description: String(d.equipmentDescription || '').trim(),
              },
            ]
          : [];
    setEquipmentItems(items.filter((it) => it.assetId || it.description));
    const fromD = String(initialHire.fromDate || d.hireStartDate || '').slice(0, 10);
    const toD = String(initialHire.toDate || d.hireEndDate || '').slice(0, 10);
    setForm((prev) => ({
      ...prev,
      hirerName: String(d.hirerName || initialHire.contactName || '').trim(),
      entityOrProject,
      companyEntity: company,
      project: proj,
      address: String(d.address || '').trim(),
      phone: String(d.phone || initialHire.phone || '').trim(),
      email: String(d.email || initialHire.email || '').trim(),
      equipmentDescription: '',
      assetId: '',
      hireStartDate: fromD,
      hireStartTime: String(d.hireStartTime || '').trim(),
      hireEndDate: toD,
      rate: d.rate != null && String(d.rate).trim() !== '' ? String(d.rate) : '',
      ratePeriod: normalizeRatePeriodUi(d.ratePeriod),
    }));
    setAddressQuery(String(d.address || '').trim());
    setAssetQuery('');
    setAssetSuggestions([]);
    setErrors({});
  }, [initialHire, hireFormMode]);

  // Algolia: clients (Company / Entity) and projects — same pattern as ActionsForm.js
  const [companySearch, setCompanySearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedCompanyHit, setSelectedCompanyHit] = useState(null);
  const [selectedProjectHit, setSelectedProjectHit] = useState(null);
  const [clientHits, setClientHits] = useState([]);
  const [projectHits, setProjectHits] = useState([]);
  const [algoliaSearchingCompany, setAlgoliaSearchingCompany] = useState(false);
  const [algoliaSearchingProject, setAlgoliaSearchingProject] = useState(false);
  const [algoliaCompanyError, setAlgoliaCompanyError] = useState('');
  const [algoliaProjectError, setAlgoliaProjectError] = useState('');
  const [companyAlgoliaMeta, setCompanyAlgoliaMeta] = useState(null);
  const [projectAlgoliaMeta, setProjectAlgoliaMeta] = useState(null);
  const companyAlgoliaSeq = useRef(0);
  const projectAlgoliaSeq = useRef(0);

  // Instant validation: re-run on every form or address change
  useEffect(() => {
    setErrors(validateForm(form, addressQuery));
  }, [form, addressQuery]);

  // Clear Algolia UI state when switching entity/project mode or clearing chips
  useEffect(() => {
    if (form.entityOrProject !== 'company') {
      setSelectedCompanyHit(null);
      setCompanySearch('');
      setClientHits([]);
      setAlgoliaCompanyError('');
      setCompanyAlgoliaMeta(null);
      companyAlgoliaSeq.current += 1;
    }
    if (form.entityOrProject !== 'project') {
      setSelectedProjectHit(null);
      setProjectSearch('');
      setProjectHits([]);
      setAlgoliaProjectError('');
      setProjectAlgoliaMeta(null);
      projectAlgoliaSeq.current += 1;
    }
  }, [form.entityOrProject]);

  useEffect(() => {
    if (form.entityOrProject !== 'company') return;
    const q = companySearch.trim();
    if (selectedCompanyHit || q.length < 1) {
      setClientHits([]);
      setAlgoliaCompanyError('');
      setCompanyAlgoliaMeta(null);
      return;
    }
    companyAlgoliaSeq.current += 1;
    const seq = companyAlgoliaSeq.current;
    setAlgoliaSearchingCompany(true);
    setAlgoliaCompanyError('');
    setCompanyAlgoliaMeta(null);
    const t = setTimeout(async () => {
      try {
        const { hits, nbHits, processingTimeMS, query: serverQuery } = await algoliaQuery(ALGOLIA_INDEX_CLIENTS, q);
        if (seq !== companyAlgoliaSeq.current) return;
        const list = Array.isArray(hits) ? hits : [];
        setClientHits(list);
        setCompanyAlgoliaMeta({
          query: q,
          hitsReturned: list.length,
        });
        if (__DEV__) {
          const h0 = list[0];
          logger.log('[HireDisclaimer][Algolia clients]', {
            index: ALGOLIA_INDEX_CLIENTS,
            query: q,
            serverQuery,
            nbHits,
            hitsReturned: list.length,
            processingTimeMS,
            firstHitKeys: h0 ? Object.keys(h0) : [],
            firstHitDisplay: h0 ? algoliaHitDisplay(h0) : null,
          });
        }
      } catch (e) {
        if (seq !== companyAlgoliaSeq.current) return;
        setClientHits([]);
        setCompanyAlgoliaMeta(null);
        setAlgoliaCompanyError('Could not load client suggestions. Check network or Algolia key/index access.');
        if (__DEV__) logger.warn('[HireDisclaimer] Algolia clients:', e?.message || e);
      } finally {
        if (seq === companyAlgoliaSeq.current) setAlgoliaSearchingCompany(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [companySearch, selectedCompanyHit, form.entityOrProject]);

  useEffect(() => {
    if (form.entityOrProject !== 'project') return;
    const q = projectSearch.trim();
    if (selectedProjectHit || q.length < 1) {
      setProjectHits([]);
      setAlgoliaProjectError('');
      setProjectAlgoliaMeta(null);
      return;
    }
    projectAlgoliaSeq.current += 1;
    const seq = projectAlgoliaSeq.current;
    setAlgoliaSearchingProject(true);
    setAlgoliaProjectError('');
    setProjectAlgoliaMeta(null);
    const t = setTimeout(async () => {
      try {
        const { hits, nbHits, processingTimeMS, query: serverQuery } = await algoliaQuery(ALGOLIA_INDEX_PROJECTS, q);
        if (seq !== projectAlgoliaSeq.current) return;
        const list = Array.isArray(hits) ? hits : [];
        setProjectHits(list);
        setProjectAlgoliaMeta({
          query: q,
          hitsReturned: list.length,
        });
        if (__DEV__) {
          const h0 = list[0];
          logger.log('[HireDisclaimer][Algolia projects]', {
            index: ALGOLIA_INDEX_PROJECTS,
            query: q,
            serverQuery,
            nbHits,
            hitsReturned: list.length,
            processingTimeMS,
            firstHitKeys: h0 ? Object.keys(h0) : [],
            firstHitDisplay: h0 ? algoliaHitDisplay(h0) : null,
          });
        }
      } catch (e) {
        if (seq !== projectAlgoliaSeq.current) return;
        setProjectHits([]);
        setProjectAlgoliaMeta(null);
        setAlgoliaProjectError('Could not load project suggestions. Check network or Algolia key/index access.');
        if (__DEV__) logger.warn('[HireDisclaimer] Algolia projects:', e?.message || e);
      } finally {
        if (seq === projectAlgoliaSeq.current) setAlgoliaSearchingProject(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [projectSearch, selectedProjectHit, form.entityOrProject]);

  useEffect(() => {
    // If suggestions are disabled (missing API key), keep list hidden
    if (!addressSuggestEnabled) {
      setAddressSuggestions([]);
      return;
    }
    // After selecting an address, suppress one autocomplete cycle to avoid
    // showing a duplicate-looking suggestion row with the same text.
    if (suppressNextSuggestions.current) {
      suppressNextSuggestions.current = false;
      setAddressSuggestions([]);
      return;
    }
    const q = (addressQuery || '').trim();
    if (!q || q.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setAddressLoading(true);
        const res = await fetch(`${API_BASE_URL}/places/autocomplete?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          if (res.status === 400 && /GOOGLE_PLACES_API_KEY/i.test(j?.error || '')) {
            setAddressSuggestEnabled(false);
          }
          setAddressSuggestions([]);
          return;
        }
        const json = await res.json();
        setAddressSuggestions(Array.isArray(json.predictions) ? json.predictions : []);
      } catch (e) {
        logger.warn('HireDisclaimerForm: address autocomplete failed', e?.message || e);
        setAddressSuggestions([]);
      } finally {
        setAddressLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [addressQuery, addressSuggestEnabled]);

  // Load assets once for local search (id, serial_number, description)
  useEffect(() => {
    let ignore = false;
    if (assetsLoaded) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/assets?debug=1`);
        if (!res.ok) return;
        const json = await res.json();
        if (ignore) return;
        const list = Array.isArray(json) ? json : [];
        // Deduplicate by ID in case the API returns the same asset more than once
        const seen = new Set();
        assetsCacheRef.current = list
          .filter((a) => {
            const id = String(a.id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .map((a) => ({
            id: String(a.id),
            serial: a.serial_number ? String(a.serial_number) : '',
            description: a.description || '',
            model: a.model || '',
            typeName: a.asset_types?.name || '',
            status: a.status || '',
          }));
        setAssetsLoaded(true);
      } catch (e) {
        logger.warn('HireDisclaimerForm: assets list fetch failed', e?.message || e);
        // asset search will not be available
      }
    })();
    return () => { ignore = true; };
  }, [assetsLoaded]);

  // Filter assets by query
  useEffect(() => {
    const q = (assetQuery || '').trim().toLowerCase();
    if (suppressNextAssetSuggestions.current) {
      // Skip one cycle right after selecting an asset, to avoid
      // rendering a suggestion row that duplicates the chosen value.
      suppressNextAssetSuggestions.current = false;
      setAssetSuggestions([]);
      return;
    }
    if (!q || !assetsLoaded) {
      setAssetSuggestions([]);
      return;
    }

    // UUID = placeholder "awaiting QR" asset — not yet configured for real use.
    const isUUID = (s) =>
      typeof s === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

    // Statuses that mean the asset is unavailable for a new hire.
    const UNAVAILABLE = new Set(['On Hire', 'End of Life', 'Lost', 'Stolen']);

    const all = assetsCacheRef.current || [];
    const matches = all
      .filter((a) => {
        // Exclude QR placeholder assets (description sentinel)
        if (String(a.description || '').toLowerCase() === 'qr reserved asset') return false;
        // Exclude awaiting-QR assets (temp UUID id, not yet assigned a real QR code)
        if (isUUID(String(a.id))) return false;
        // Exclude assets that are already on hire, end-of-life, lost, or stolen
        if (UNAVAILABLE.has(a.status)) return false;
        const hay = `${a.id} ${a.serial} ${a.model} ${a.description} ${a.typeName}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
    setAssetSuggestions(matches);
  }, [assetQuery, assetsLoaded]);

  const onSelectAddress = useCallback(async (placeId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/places/details?id=${encodeURIComponent(placeId)}`);
      if (!res.ok) return;
      const json = await res.json();
      const addr = json?.formatted_address || '';
      setForm((prev) => ({ ...prev, address: addr }));
      setAddressQuery(addr);
      suppressNextSuggestions.current = true;
      setAddressSuggestions([]);
    } catch (e) {
      logger.warn('HireDisclaimerForm: place details fetch failed', e?.message || e);
    }
  }, []);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'address') {
      setAddressQuery(value);
      setAddressSuggestEnabled(true);
    }
  };

  const handleSelectAsset = (asset) => {
    const displayId = asset.serial || asset.id;
    const descFromAsset = asset.description || asset.model || '';
    setForm((prev) => ({
      ...prev,
      assetId: displayId,
      equipmentDescription: prev.equipmentDescription || descFromAsset,
    }));
    setAssetQuery(displayId);
    // Hide suggestions once; effect will skip next cycle.
    suppressNextAssetSuggestions.current = true;
    setAssetSuggestions([]);
  };

  const handleAddEquipmentLine = () => {
    const idVal = (form.assetId || assetQuery || '').trim();
    const descVal = (form.equipmentDescription || '').trim();
    if (!idVal && !descVal) {
      return;
    }
    setEquipmentItems((prev) => [...prev, { assetId: idVal, description: descVal }]);
    // Clear current line
    setForm((prev) => ({ ...prev, assetId: '', equipmentDescription: '' }));
    setAssetQuery('');
    setAssetSuggestions([]);
  };

  const handleRemoveEquipmentLine = (index) => {
    setEquipmentItems((prev) => prev.filter((_, i) => i !== index));
  };

  /** Backend needs YYYY-MM-DD for day counts and DB — never send display-only strings. */
  const dateForApi = (value) => {
    if (!value) return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return toISO(d);
  };

  const buildHireApiPayload = () => ({
    ...(isEditingExisting ? { existingActionId: initialHire.id } : {}),
    hirerName: form.hirerName,
    companyEntity: form.companyEntity,
    project: form.project,
    address: form.address,
    phone: form.phone,
    email: form.email,
    equipmentDescription: form.equipmentDescription,
    assetId: form.assetId || undefined,
    hireStartDate: dateForApi(form.hireStartDate),
    hireEndDate: dateForApi(form.hireEndDate),
    hireStartTime: form.hireStartTime,
    hireEndTime: '',
    equipmentItems: [
      ...equipmentItems,
      ...(((form.assetId || assetQuery || '').trim() || (form.equipmentDescription || '').trim())
        ? [{ assetId: (form.assetId || assetQuery || '').trim(), description: (form.equipmentDescription || '').trim() }]
        : []),
    ],
    rate: form.rate,
    ratePeriod: form.ratePeriod,
    termsAgreed: true,
    signatureName: (form.hirerName || '').trim(),
    signatureDate: toISO(new Date()),
    additionalTerms: form.additionalTerms || undefined,
  });

  const formBusy = generating || sharingSig;

  /** Save hire then open an embedded DocuSign signing session in a new tab (in-person signing). */
  const handleGenerateAndSign = async () => {
    const errs = validateForm(form, addressQuery);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (!docusignEnabled) {
      Alert.alert(
        'DocuSign not configured',
        'DocuSign is not set up on the server. Ask your administrator to add the DocuSign credentials to the API environment.'
      );
      return;
    }
    setErrors({});
    setGenerating(true);
    try {
      const saveRes = await fetch(`${API_BASE_URL}/hire-disclaimer/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildHireApiPayload(), respondWith: 'json' }),
      });
      const saveJson = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        if (saveRes.status === 409 && saveJson.conflict) {
          setConflictInfo(saveJson.conflict);
          return;
        }
        throw new Error(saveJson.error || saveRes.statusText || 'Could not save hire');
      }
      const hireId = saveJson.hireId;

      // Point back to our backend return handler so DocuSign triggers the signed-PDF download
      // and the tab notifies the parent window via postMessage before closing itself.
      const returnUrl = `${String(API_BASE_URL || '').replace(/\/$/, '')}/hire-disclaimer/hires/${encodeURIComponent(hireId)}/docusign/return`;

      const dsRes = await fetch(
        `${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hireId)}/docusign/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryMethod: 'embedded', returnUrl }),
        }
      );
      const dsJson = await dsRes.json().catch(() => ({}));
      if (!dsRes.ok) {
        throw new Error(dsJson.error || dsRes.statusText || 'Could not create signing session');
      }
      const signingUrl = dsJson.signingUrl;
      if (!signingUrl) {
        throw new Error('No signing URL returned from DocuSign');
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(signingUrl, '_blank');
      } else {
        await Linking.openURL(signingUrl);
      }
      if (typeof onGenerated === 'function') onGenerated(hireId);
    } catch (e) {
      Alert.alert('Sign failed', e?.message || 'Could not open signing page.');
    } finally {
      setGenerating(false);
    }
  };

  /** DocuSign: email the lessee a link to review the disclaimer and sign the lease. */
  const handleSendViaEmail = async () => {
    if (!docusignEnabled) {
      Alert.alert(
        'DocuSign not configured',
        'DocuSign is not set up on the server. Ask your administrator to add the DocuSign credentials to the API environment.'
      );
      return;
    }
    const errs = validateForm(form, addressQuery);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const email = (form.email || '').trim();
    if (!EMAIL_REGEX.test(email)) {
      setErrors((prev) => ({ ...prev, email: 'Please enter a valid email address' }));
      return;
    }
    setErrors({});
    setSharingSig(true);
    try {
      const saveRes = await fetch(`${API_BASE_URL}/hire-disclaimer/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildHireApiPayload(), respondWith: 'json' }),
      });
      const saveJson = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        if (saveRes.status === 409 && saveJson.conflict) {
          setConflictInfo(saveJson.conflict);
          return;
        }
        throw new Error(saveJson.error || saveRes.statusText || 'Could not save hire');
      }
      const hireId = saveJson.hireId;
      const dsRes = await fetch(
        `${API_BASE_URL}/hire-disclaimer/hires/${encodeURIComponent(hireId)}/docusign/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryMethod: 'email' }),
        }
      );
      const dsJson = await dsRes.json().catch(() => ({}));
      if (!dsRes.ok) {
        throw new Error(dsJson.error || dsRes.statusText || 'DocuSign send failed');
      }
      if (typeof onGenerated === 'function') onGenerated(hireId);
    } catch (e) {
      Alert.alert('Send failed', e?.message || 'Could not send signing email.');
    } finally {
      setSharingSig(false);
    }
  };

  const field = (label, key, props = {}) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}<Text style={styles.requiredStar}> *</Text></Text>
      <TextInput
        style={[styles.input, props.multiline && styles.inputMultiline]}
        value={form[key]}
        onChangeText={(v) => update(key, v)}
        placeholderTextColor={Colors.sub2}
        {...props}
      />
    </View>
  );

  const dateField = (label, key) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}<Text style={styles.requiredStar}> *</Text></Text>
      <TouchableOpacity
        style={styles.input}
        onPress={() => setDatePicker({ open: true, field: key })}
      >
        <Text style={{ color: form[key] ? Colors.text : Colors.sub2 }}>
          {form[key] ? formatDisplayDateLong(form[key], '') : 'Select date'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const timeField = (label, key, { optional = false } = {}) => {
    const { hours, minutes } = parseTime(form[key]);
    return (
      <View style={styles.field}>
        <Text style={styles.label}>
          {label}
          {optional ? ' (optional)' : null}
          {!optional ? <Text style={styles.requiredStar}> *</Text> : null}
        </Text>
        <TouchableOpacity
          style={styles.input}
          onPress={() => setTimePicker({ open: true, field: key })}
        >
          <Text style={{ color: form[key] ? Colors.text : Colors.sub2 }}>
            {form[key] || (optional ? 'Select time if needed' : 'Select time')}
          </Text>
        </TouchableOpacity>
        {optional && form[key] ? (
          <TouchableOpacity onPress={() => update(key, '')} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Text style={styles.suggestHint}>Clear pickup time</Text>
          </TouchableOpacity>
        ) : null}
        <TimePickerModal
          visible={timePicker.open && timePicker.field === key}
          onDismiss={() => setTimePicker({ open: false, field: null })}
          onConfirm={({ hours: h, minutes: m }) => {
            update(key, formatTime(h, m));
            setTimePicker({ open: false, field: null });
          }}
          hours={hours}
          minutes={minutes}
          label={label}
          cancelLabel="Cancel"
          confirmLabel="OK"
          use24HourClock={false}
        />
      </View>
    );
  };

  /** Optional: tap again on the selected chip to clear choice and both fields. */
  const setEntityOrProjectMode = (mode) => {
    setForm((prev) => {
      if (prev.entityOrProject === mode) {
        return { ...prev, entityOrProject: '', companyEntity: '', project: '' };
      }
      return {
        ...prev,
        entityOrProject: mode,
        companyEntity: mode === 'company' ? prev.companyEntity : '',
        project: mode === 'project' ? prev.project : '',
      };
    });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.contentWrap}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <View style={[styles.form, styles.formStacking]}>
        <Text style={styles.title}>Equipment Hire Lease Disclaimer</Text>
        <Text style={styles.subtitle}>
          {hireFormMode === 'edit' && initialHire?.id
            ? 'Editing an existing hire. Use Generate PDF & Sign for in-person signing, or Send via email to dispatch a DocuSign signing request to the contact.'
            : hireFormMode === 'copy' && initialHire?.id
              ? 'Details loaded from an existing hire. Review and adjust, then choose an action below.'
              : 'Complete the form. Use Generate PDF & Sign to open the lease in DocuSign for in-person signing, or Send via email to have the lessee sign remotely. Once signed, both the lessee and the office receive a copy and the hire status updates to Signed.'}
        </Text>

        <View style={[styles.section, styles.sectionFirst]}>
          <Text style={styles.sectionTitle}>Hirer details</Text>
          {field('Contact person (name)', 'hirerName')}
          <View style={styles.field}>
            <Text style={styles.label}>Company / Entity or Project (optional)</Text>
            <View style={styles.choiceRow}>
              <TouchableOpacity
                style={[
                  styles.choiceChip,
                  form.entityOrProject === 'company' && styles.choiceChipSelected,
                ]}
                onPress={() => setEntityOrProjectMode('company')}
                accessibilityRole="button"
                accessibilityState={{ selected: form.entityOrProject === 'company' }}
              >
                <Text
                  style={[
                    styles.choiceChipText,
                    form.entityOrProject === 'company' && styles.choiceChipTextSelected,
                  ]}
                >
                  Company / Entity
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.choiceChip,
                  form.entityOrProject === 'project' && styles.choiceChipSelected,
                ]}
                onPress={() => setEntityOrProjectMode('project')}
                accessibilityRole="button"
                accessibilityState={{ selected: form.entityOrProject === 'project' }}
              >
                <Text
                  style={[
                    styles.choiceChipText,
                    form.entityOrProject === 'project' && styles.choiceChipTextSelected,
                  ]}
                >
                  Project
                </Text>
              </TouchableOpacity>
            </View>
            {form.entityOrProject === 'company' ? (
              <View style={[styles.algoliaFieldBlock, { marginTop: 10 }]}>
                <Text style={styles.suggestHint}>Type to search clients — or enter a name manually.</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={[styles.input, { paddingRight: 36 }]}
                    value={selectedCompanyHit ? algoliaHitDisplay(selectedCompanyHit) : companySearch}
                    onChangeText={(v) => {
                      setSelectedCompanyHit(null);
                      setCompanySearch(v);
                      update('companyEntity', v);
                    }}
                    placeholder="Search clients…"
                    placeholderTextColor={Colors.sub2}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {(selectedCompanyHit || companySearch) ? (
                    <TouchableOpacity
                      style={styles.clearBtn}
                      onPress={() => {
                        setSelectedCompanyHit(null);
                        setCompanySearch('');
                        update('companyEntity', '');
                        setClientHits([]);
                        setAlgoliaCompanyError('');
                        setCompanyAlgoliaMeta(null);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={18} color={Colors.sub} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {algoliaSearchingCompany && companySearch.trim().length >= 1 && !selectedCompanyHit ? (
                  <View style={{ marginTop: 8 }}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                  </View>
                ) : null}
                {!!algoliaCompanyError && (
                  <Text style={styles.fieldError}>{algoliaCompanyError}</Text>
                )}
                {(() => {
                  const qTrim = companySearch.trim();
                  const metaOk = companyAlgoliaMeta && companyAlgoliaMeta.query === qTrim;
                  const showNoMatches =
                    qTrim.length >= 1 &&
                    !selectedCompanyHit &&
                    !algoliaSearchingCompany &&
                    !algoliaCompanyError &&
                    metaOk &&
                    companyAlgoliaMeta.hitsReturned === 0;
                  return (
                    <>
                      {showNoMatches ? (
                        <View style={[styles.algoliaEmptyPanel, styles.algoliaSuggestBox, { marginTop: 6 }]}>
                          <Text style={styles.algoliaEmptyTitle}>No matching clients</Text>
                          <Text style={styles.algoliaEmptySub}>
                            No results for &quot;{qTrim}&quot;. You can type the company name manually.
                          </Text>
                        </View>
                      ) : null}
                      {qTrim.length >= 1 && !selectedCompanyHit && clientHits.length > 0 ? (
                        <View style={[styles.suggestBox, styles.algoliaSuggestBox, { marginTop: 6 }]}>
                          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                            {clientHits.map((hit, hitIdx) => (
                              <TouchableOpacity
                                key={String(hit.objectID ?? `c-${hitIdx}`)}
                                style={styles.suggestItem}
                                onPress={() => {
                                  const label = algoliaHitDisplay(hit);
                                  setSelectedCompanyHit(hit);
                                  setCompanySearch('');
                                  update('companyEntity', label || String(hit.objectID || ''));
                                  setClientHits([]);
                                  setAlgoliaCompanyError('');
                                  setCompanyAlgoliaMeta(null);
                                }}
                              >
                                <Text style={[styles.suggestMain, { fontWeight: '600' }]}>
                                  {algoliaHitDisplay(hit) || hit.objectID || '—'}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            ) : null}
            {form.entityOrProject === 'project' ? (
              <View style={[styles.algoliaFieldBlock, { marginTop: 10 }]}>
                <Text style={styles.suggestHint}>Type to search projects — or enter a name manually.</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={[styles.input, { paddingRight: 36 }]}
                    value={selectedProjectHit ? algoliaHitDisplay(selectedProjectHit) : projectSearch}
                    onChangeText={(v) => {
                      setSelectedProjectHit(null);
                      setProjectSearch(v);
                      update('project', v);
                    }}
                    placeholder="Search projects…"
                    placeholderTextColor={Colors.sub2}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {(selectedProjectHit || projectSearch) ? (
                    <TouchableOpacity
                      style={styles.clearBtn}
                      onPress={() => {
                        setSelectedProjectHit(null);
                        setProjectSearch('');
                        update('project', '');
                        setProjectHits([]);
                        setAlgoliaProjectError('');
                        setProjectAlgoliaMeta(null);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={18} color={Colors.sub} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {algoliaSearchingProject && projectSearch.trim().length >= 1 && !selectedProjectHit ? (
                  <View style={{ marginTop: 8 }}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                  </View>
                ) : null}
                {!!algoliaProjectError && (
                  <Text style={styles.fieldError}>{algoliaProjectError}</Text>
                )}
                {(() => {
                  const qTrim = projectSearch.trim();
                  const metaOk = projectAlgoliaMeta && projectAlgoliaMeta.query === qTrim;
                  const showNoMatches =
                    qTrim.length >= 1 &&
                    !selectedProjectHit &&
                    !algoliaSearchingProject &&
                    !algoliaProjectError &&
                    metaOk &&
                    projectAlgoliaMeta.hitsReturned === 0;
                  return (
                    <>
                      {showNoMatches ? (
                        <View style={[styles.algoliaEmptyPanel, styles.algoliaSuggestBox, { marginTop: 6 }]}>
                          <Text style={styles.algoliaEmptyTitle}>No matching projects</Text>
                          <Text style={styles.algoliaEmptySub}>
                            No results for &quot;{qTrim}&quot;. You can type the project name manually.
                          </Text>
                        </View>
                      ) : null}
                      {qTrim.length >= 1 && !selectedProjectHit && projectHits.length > 0 ? (
                        <View style={[styles.suggestBox, styles.algoliaSuggestBox, { marginTop: 6 }]}>
                          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                            {projectHits.map((hit, hitIdx) => (
                              <TouchableOpacity
                                key={String(hit.objectID ?? `p-${hitIdx}`)}
                                style={styles.suggestItem}
                                onPress={() => {
                                  const label = algoliaHitDisplay(hit);
                                  setSelectedProjectHit(hit);
                                  setProjectSearch('');
                                  update('project', label || String(hit.objectID || ''));
                                  setProjectHits([]);
                                  setAlgoliaProjectError('');
                                  setProjectAlgoliaMeta(null);
                                }}
                              >
                                <Text style={[styles.suggestMain, { fontWeight: '600' }]}>
                                  {algoliaHitDisplay(hit) || hit.objectID || '—'}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            ) : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Address of company / entity / person<Text style={styles.requiredStar}> *</Text></Text>
            <TextInput
              style={styles.input}
              value={addressQuery}
              onChangeText={(v) => {
                setAddressQuery(v);
                update('address', v);
              }}
              placeholder="Search or type address"
              placeholderTextColor={Colors.sub2}
            />
            {addressLoading && (
              <View style={styles.suggestLoading}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            )}
            {!addressSuggestEnabled && addressQuery.length >= 3 && (
              <Text style={styles.suggestHint}>Address suggestions unavailable (API key not set).</Text>
            )}
            {addressSuggestions.length > 0 && (
              <View style={styles.suggestBox}>
                {addressSuggestions.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.suggestItem}
                    onPress={() => onSelectAddress(item.id)}
                  >
                    <Text style={styles.suggestMain}>{item.description}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {errors.address ? <Text style={styles.fieldError}>{errors.address}</Text> : null}
          </View>
          {field('Contact Number', 'phone', { keyboardType: 'phone-pad' })}
          {errors.phone ? <Text style={styles.fieldError}>{errors.phone}</Text> : null}
          {field('Email', 'email', { keyboardType: 'email-address', autoCapitalize: 'none' })}
          {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Equipment</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Asset / Serial ID<Text style={styles.requiredStar}> *</Text></Text>
            <TextInput
              style={styles.input}
              value={assetQuery}
              onChangeText={(v) => setAssetQuery(v)}
              placeholder="Search by ID, serial, type, model or description"
              placeholderTextColor={Colors.sub2}
            />
            {assetSuggestions.length > 0 && (
              <View style={styles.assetSuggestBox}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {assetSuggestions.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.assetSuggestItem}
                      onPress={() => handleSelectAsset(a)}
                    >
                      <Text style={styles.assetSuggestMain}>
                        {a.serial || a.id}
                        {a.typeName ? (
                          <Text style={styles.assetSuggestType}>{' · '}{a.typeName}</Text>
                        ) : null}
                      </Text>
                      <Text style={styles.assetSuggestSub}>
                        {[a.model, a.description].filter(Boolean).join(' — ') || 'No description'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          {field('Equipment description', 'equipmentDescription', { multiline: true })}
          {(() => {
            const hasEquipmentData = ((assetQuery || '').trim() || (form.equipmentDescription || '').trim()) !== '';
            return (
              <View style={styles.equipmentActionsRow}>
                <TouchableOpacity
                  style={[styles.equipmentAddBtn, hasEquipmentData && styles.equipmentAddBtnHighlighted]}
                  onPress={handleAddEquipmentLine}
                >
                  <Text style={[styles.equipmentAddText, hasEquipmentData && styles.equipmentAddTextHighlighted]}>
                    Add asset to list
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })()}
          {equipmentItems.length > 0 && (
            <View style={styles.equipmentList}>
              {equipmentItems.map((item, idx) => (
                <View key={`${item.assetId}-${idx}`} className="equipment-pill" style={styles.equipmentItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.equipmentItemTitle}>{item.assetId || `Asset ${idx + 1}`}</Text>
                    {!!item.description && (
                      <Text style={styles.equipmentItemSub} numberOfLines={2}>
                        {item.description}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.equipmentRemoveBtn}
                    onPress={() => handleRemoveEquipmentLine(idx)}
                  >
                    <Text style={styles.equipmentRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hire period</Text>
          {dateField('Start date', 'hireStartDate')}
          {timeField('Pickup time', 'hireStartTime', { optional: true })}
          {dateField('Return date', 'hireEndDate')}
          {errors.hirePeriod ? <Text style={styles.fieldError}>{errors.hirePeriod}</Text> : null}
          <View style={styles.field}>
            <Text style={styles.label}>Rate<Text style={styles.requiredStar}> *</Text></Text>
            <Text style={styles.suggestHint}>Choose whether the amount is per day, week, or month.</Text>
            {(() => {
              // ── Smart rate-period enable/disable ────────────────────────────
              // Compute inclusive day count from the selected dates.
              const hireDays = (() => {
                if (!form.hireStartDate || !form.hireEndDate) return 0;
                const s = new Date(`${form.hireStartDate}T12:00:00Z`);
                const e = new Date(`${form.hireEndDate}T12:00:00Z`);
                if (isNaN(s) || isNaN(e)) return 0;
                const diff = Math.round((e - s) / 86400000);
                return diff < 0 ? 0 : diff + 1;
              })();
              const weekEnabled  = hireDays === 0 || hireDays >= 6;
              const monthEnabled = hireDays === 0 || hireDays >= 30;

              // Auto-reset to 'day' when the selected period becomes unavailable.
              if (!weekEnabled  && form.ratePeriod === 'week')  update('ratePeriod', 'day');
              if (!monthEnabled && form.ratePeriod === 'month') update('ratePeriod', 'day');

              const chips = [
                { key: 'day',   label: 'Per day',   enabled: true },
                { key: 'week',  label: 'Per week',  enabled: weekEnabled },
                { key: 'month', label: 'Per month', enabled: monthEnabled },
              ];

              return (
                <View style={[styles.ratePeriodRow, { marginTop: 8, marginBottom: 10 }]}>
                  {chips.map(({ key, label, enabled }) => (
                    <TouchableOpacity
                      key={key}
                      disabled={!enabled}
                      style={[
                        styles.chip,
                        form.ratePeriod === key && styles.chipActive,
                        !enabled && { opacity: 0.35 },
                      ]}
                      onPress={() => enabled && update('ratePeriod', key)}
                    >
                      <Text style={[styles.chipText, form.ratePeriod === key && styles.chipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
            <View style={styles.rateInputRow}>
              <Text style={styles.ratePrefix}>$</Text>
              <TextInput
                style={[styles.input, styles.rateInput]}
                value={form.rate}
                onChangeText={(v) => update('rate', v)}
                placeholder="100"
                placeholderTextColor={Colors.sub2}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.exportBtnShare, formBusy && !docusignEnabled ? styles.exportBtnShareDisabledDs : null, formBusy && styles.exportBtnDisabled]}
          onPress={handleSendViaEmail}
          disabled={formBusy}
        >
          {sharingSig ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <View style={styles.sendBtnInner}>
              <Text style={styles.exportBtnText}>Send via email (DocuSign)</Text>
              {!docusignEnabled && (
                <Text style={styles.sendBtnNote}>DocuSign not configured</Text>
              )}
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.exportBtnSecondary,
            !docusignEnabled && styles.exportBtnSecondaryDisabled,
            formBusy && styles.exportBtnDisabled,
          ]}
          onPress={handleGenerateAndSign}
          disabled={formBusy}
        >
          {generating ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <View style={styles.sendBtnInner}>
              <Text style={styles.exportBtnSecondaryText}>Generate PDF & Sign</Text>
              {!docusignEnabled && (
                <Text style={styles.sendBtnNote2}>DocuSign not configured</Text>
              )}
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Hire conflict modal ──────────────────────────────────────────── */}
      <Modal
        transparent
        animationType="fade"
        visible={!!conflictInfo}
        onRequestClose={() => setConflictInfo(null)}
      >
        <View style={styles.conflictOverlay}>
          <View style={styles.conflictCard}>
            {/* Icon + title */}
            <View style={styles.conflictHeader}>
              <View style={styles.conflictIconWrap}>
                <MaterialIcons name="event-busy" size={28} color="#DC2626" />
              </View>
              <Text style={styles.conflictTitle}>Booking Conflict</Text>
            </View>

            {/* Body text */}
            <Text style={styles.conflictBody}>
              This asset is already booked during the selected dates and cannot be double-hired.
            </Text>

            {/* Conflict details pill */}
            {conflictInfo && (
              <View style={styles.conflictDetail}>
                <View style={styles.conflictDetailRow}>
                  <MaterialIcons name="person" size={15} color={Colors.sub} style={{ marginRight: 5 }} />
                  <Text style={styles.conflictDetailLabel}>Hirer</Text>
                  <Text style={styles.conflictDetailValue}>{conflictInfo.hirerName || '—'}</Text>
                </View>
                <View style={styles.conflictDetailRow}>
                  <MaterialIcons name="date-range" size={15} color={Colors.sub} style={{ marginRight: 5 }} />
                  <Text style={styles.conflictDetailLabel}>Booked</Text>
                  <Text style={styles.conflictDetailValue}>
                    {conflictInfo.from ? formatDisplayDateLong(conflictInfo.from, conflictInfo.from) : '?'} → {conflictInfo.to ? formatDisplayDateLong(conflictInfo.to, conflictInfo.to) : '?'}
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.conflictHint}>
              Please choose different hire dates or select a different asset.
            </Text>

            {/* Dismiss */}
            <TouchableOpacity
              style={styles.conflictBtn}
              onPress={() => setConflictInfo(null)}
            >
              <Text style={styles.conflictBtnText}>OK, Change Dates</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DatePickerModal
        locale="en"
        mode="single"
        visible={datePicker.open}
        onDismiss={() => setDatePicker({ open: false, field: null })}
        onConfirm={({ date }) => {
          if (datePicker.field) {
            const iso = toISO(date);
            setForm((prev) => ({ ...prev, [datePicker.field]: iso }));
          }
          setDatePicker({ open: false, field: null });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    ...Platform.select({
      web: { overflow: 'visible' },
      default: {},
    }),
  },
  contentWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    paddingBottom: 48,
    ...Platform.select({
      web: { overflow: 'visible' },
      default: {},
    }),
  },
  form: {
    width: '100%',
    maxWidth: 800,
    padding: 24,
  },
  formStacking: {
    ...Platform.select({
      web: {
        position: 'relative',
        zIndex: 2,
      },
      default: {},
    }),
  },
  title: {
    fontSize: sf(24),
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: sf(14),
    color: Colors.sub,
    marginBottom: 28,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
    paddingTop: 20,
    borderTopWidth: 2,
    borderTopColor: Colors.line,
  },
  sectionFirst: {
    paddingTop: 0,
    borderTopWidth: 0,
  },
  sectionTitle: {
    fontSize: sf(15),
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 12,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  field: { marginBottom: 14 },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  choiceChip: {
    flex: 1,
    minWidth: 140,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
    alignItems: 'center',
  },
  choiceChipSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  choiceChipText: {
    fontSize: sf(14),
    fontWeight: '600',
    color: Colors.sub,
    textAlign: 'center',
  },
  choiceChipTextSelected: {
    color: Colors.accentDark,
    fontWeight: '700',
  },
  label: { fontSize: sf(13), fontWeight: '600', color: Colors.text, marginBottom: 4 },
  requiredStar: { color: Colors.dangerFg },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: sf(15),
    color: Colors.text,
    minHeight: 46,
  },
  rateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    minHeight: 46,
    overflow: 'hidden',
  },
  ratePrefix: {
    fontSize: sf(15),
    fontWeight: '700',
    color: Colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRightWidth: 2,
    borderRightColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  rateInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
    minHeight: 46,
  },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
  inputWrap: {
    position: 'relative',
  },
  clearBtn: {
    position: 'absolute',
    right: 10,
    top: Platform.OS === 'ios' ? 10 : Platform.OS === 'web' ? 11 : 8,
    padding: 6,
  },
  suggestBox: {
    marginTop: 4,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    maxHeight: 200,
    zIndex: 1000,
  },
  /** Lift hire-form Algolia dropdowns above the address field (web stacking / scroll clipping). */
  algoliaFieldBlock: {
    ...Platform.select({
      web: { zIndex: 5000, position: 'relative' },
      default: { elevation: 8, zIndex: 20 },
    }),
  },
  algoliaSuggestBox: {
    ...Platform.select({
      web: {
        zIndex: 99999,
        position: 'relative',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
      },
      default: { elevation: 16 },
    }),
  },
  algoliaEmptyPanel: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg,
  },
  algoliaEmptyTitle: {
    fontSize: sf(14),
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  algoliaEmptySub: {
    fontSize: sf(13),
    color: Colors.sub,
    lineHeight: 18,
  },
  suggestItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  suggestMain: { fontSize: sf(14), color: Colors.text },
  suggestLoading: { position: 'absolute', right: 12, top: 38 },
  suggestHint: { fontSize: sf(12), color: Colors.sub, marginTop: 4 },
  fieldError: { fontSize: sf(12), color: Colors.dangerFg, marginTop: 4, marginBottom: 4 },
  ratePeriodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    backgroundColor: Colors.chip,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  chipActive: { backgroundColor: Colors.accentMuted, borderColor: Colors.accent },
  chipText: { fontSize: sf(14), fontWeight: '600', color: Colors.sub },
  chipTextActive: { color: Colors.accentDark, fontWeight: '700' },
  assetSuggestBox: {
    marginTop: 4,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    maxHeight: 260,
    overflow: 'hidden',
    zIndex: 900,
  },
  assetSuggestItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  assetSuggestMain: { fontSize: sf(14), fontWeight: '600', color: Colors.text },
  assetSuggestType: { fontSize: sf(13), fontWeight: '400', color: Colors.sub2 },
  assetSuggestSub: { fontSize: sf(12), color: Colors.sub },
  equipmentActionsRow: {
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  equipmentAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.bg,
  },
  equipmentAddBtnHighlighted: {
    backgroundColor: Colors.accentMuted,
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  equipmentAddText: { fontSize: sf(12), fontWeight: '600', color: Colors.accent },
  equipmentAddTextHighlighted: { color: Colors.accentDark, fontWeight: '700' },
  equipmentList: { marginTop: 4, gap: 6 },
  equipmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.line,
    backgroundColor: Colors.bg,
    marginBottom: 4,
    gap: 8,
  },
  equipmentItemTitle: { fontSize: sf(13), fontWeight: '700', color: Colors.text },
  equipmentItemSub: { fontSize: sf(12), color: Colors.sub, marginTop: 2 },
  equipmentRemoveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.dangerFg,
    backgroundColor: Colors.dangerBg,
  },
  equipmentRemoveText: { fontSize: sf(11), fontWeight: '700', color: Colors.dangerFg },
  exportBtn: {
    marginTop: 12,
    backgroundColor: Colors.accent,
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  exportBtnSecondary: {
    marginTop: 10,
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  exportBtnSecondaryText: { fontSize: sf(15), fontWeight: '700', color: Colors.accent, textTransform: 'uppercase' },
  exportBtnShare: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  exportBtnShareDisabledDs: { backgroundColor: Colors.sub },
  exportBtnSecondaryDisabled: { borderColor: Colors.sub2, opacity: 0.75 },
  sendBtnInner: { alignItems: 'center', gap: 3 },
  sendBtnNote: { fontSize: sf(11), color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  sendBtnNote2: { fontSize: sf(11), color: Colors.sub, fontWeight: '600', marginTop: 2 },
  exportBtnDisabled: { opacity: 0.7 },
  exportBtnText: { fontSize: sf(16), fontWeight: '700', color: '#FFF', textTransform: 'uppercase' },

  // ── Conflict modal ────────────────────────────────────────────────────────
  conflictOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  conflictCard: {
    backgroundColor: Colors.card || '#fff',
    borderRadius: Radius.lg || 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    ...Shadows.card,
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  conflictIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictTitle: {
    fontSize: sf(18),
    fontWeight: '700',
    color: Colors.text || '#111',
  },
  conflictBody: {
    fontSize: sf(14),
    color: Colors.sub || '#6B7280',
    lineHeight: sf(20),
    marginBottom: 16,
  },
  conflictDetail: {
    backgroundColor: Colors.bg || '#F9FAFB',
    borderRadius: Radius.md || 10,
    borderWidth: 1,
    borderColor: Colors.border || '#E5E7EB',
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  conflictDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conflictDetailLabel: {
    fontSize: sf(13),
    fontWeight: '600',
    color: Colors.sub || '#6B7280',
    width: 52,
    marginRight: 6,
  },
  conflictDetailValue: {
    fontSize: sf(13),
    color: Colors.text || '#111',
    fontWeight: '500',
    flex: 1,
  },
  conflictHint: {
    fontSize: sf(13),
    color: Colors.sub || '#6B7280',
    marginBottom: 20,
    lineHeight: sf(18),
  },
  conflictBtn: {
    backgroundColor: Colors.primary || '#2563EB',
    borderRadius: Radius.md || 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  conflictBtnText: {
    fontSize: sf(15),
    fontWeight: '700',
    color: '#FFF',
  },
});
