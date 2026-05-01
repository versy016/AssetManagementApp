// components/ui/PlacesAutocompleteInput.js
// Reusable Google Places autocomplete text input.
// Calls the server-side proxy at /places/autocomplete and /places/details,
// so no API key is exposed to the client.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../inventory-api/apiBase';
import { Colors, Radius, sf } from '../../constants/uiTheme';
import logger from '../../utils/logger';

/**
 * PlacesAutocompleteInput
 *
 * Props:
 *   label        {string}   Field label (shown above input)
 *   placeholder  {string}   Input placeholder text
 *   value        {string}   Controlled value (the resolved address string)
 *   onChange     {fn}       Called with the new string value on every keystroke and on selection
 *   required     {boolean}  Show asterisk on label
 *   style        {object}   Extra style for the outer container
 *   inputStyle   {object}   Extra style for the TextInput
 *   maxLength    {number}   maxLength forwarded to TextInput (default 255)
 */
export default function PlacesAutocompleteInput({
  label,
  placeholder = 'Search location…',
  value = '',
  onChange,
  required = false,
  style,
  inputStyle,
  maxLength = 255,
}) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true); // false when API key is missing
  const suppress = useRef(false);

  // Keep internal query in sync when value is changed externally (e.g. form reset)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Debounced autocomplete fetch
  useEffect(() => {
    if (!enabled) { setSuggestions([]); return; }
    if (suppress.current) { suppress.current = false; setSuggestions([]); return; }
    const q = (query || '').trim();
    if (!q || q.length < 3) { setSuggestions([]); return; }

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE_URL}/places/autocomplete?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          if (res.status === 400 && /GOOGLE_PLACES_API_KEY/i.test(j?.error || '')) {
            setEnabled(false);
          }
          setSuggestions([]);
          return;
        }
        const json = await res.json();
        setSuggestions(Array.isArray(json.predictions) ? json.predictions : []);
      } catch (e) {
        logger.warn('[PlacesAutocompleteInput] autocomplete failed', e?.message || e);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, enabled]);

  const handleSelect = async (placeId, description) => {
    // Optimistically fill with description immediately
    setQuery(description);
    onChange?.(description);
    suppress.current = true;
    setSuggestions([]);

    // Then try to resolve the canonical formatted_address
    try {
      const res = await fetch(`${API_BASE_URL}/places/details?id=${encodeURIComponent(placeId)}`);
      if (!res.ok) return;
      const json = await res.json();
      const addr = json?.formatted_address || description;
      setQuery(addr);
      onChange?.(addr);
    } catch (e) {
      logger.warn('[PlacesAutocompleteInput] place details failed', e?.message || e);
    }
  };

  const handleChangeText = (v) => {
    setQuery(v);
    onChange?.(v);
  };

  const handleClear = () => {
    setQuery('');
    onChange?.('');
    setSuggestions([]);
  };

  return (
    <View style={[s.container, style]}>
      {!!label && (
        <Text style={s.label}>
          {label}
          {required && <Text style={s.star}> *</Text>}
        </Text>
      )}

      <View style={s.inputWrap}>
        <MaterialIcons name="location-on" size={16} color={Colors.sub2 || Colors.muted} style={s.icon} />
        <TextInput
          style={[s.input, inputStyle]}
          value={query}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.muted}
          maxLength={maxLength}
          autoCorrect={false}
        />
        {loading && (
          <ActivityIndicator size="small" color={Colors.primary} style={s.spinner} />
        )}
        {!loading && !!query && (
          <TouchableOpacity onPress={handleClear} style={s.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={16} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {!enabled && query.length >= 3 && (
        <Text style={s.hint}>Location suggestions unavailable.</Text>
      )}

      {suggestions.length > 0 && (
        <View style={s.dropdown}>
          {suggestions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={s.dropdownItem}
              onPress={() => handleSelect(item.id, item.description)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="place" size={14} color={Colors.muted} style={{ marginRight: 8, marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                {item.main ? (
                  <>
                    <Text style={s.dropdownMain}>{item.main}</Text>
                    {!!item.secondary && <Text style={s.dropdownSub}>{item.secondary}</Text>}
                  </>
                ) : (
                  <Text style={s.dropdownMain}>{item.description}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    color: Colors.sub,
    fontSize: sf(12),
    marginBottom: 6,
    fontWeight: '700',
  },
  star: {
    color: Colors.accent,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
  },
  icon: {
    marginRight: 6,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: sf(14),
  },
  spinner: {
    marginLeft: 6,
  },
  clearBtn: {
    marginLeft: 6,
    padding: 2,
  },
  hint: {
    color: Colors.muted,
    fontSize: sf(11),
    marginTop: 4,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    marginTop: 4,
    overflow: 'hidden',
    shadowColor: '#1C1917',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    zIndex: 999,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  dropdownMain: {
    color: Colors.text,
    fontSize: sf(13),
    fontWeight: '600',
  },
  dropdownSub: {
    color: Colors.muted,
    fontSize: sf(11),
    marginTop: 1,
  },
});
