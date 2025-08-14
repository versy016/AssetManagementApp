import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  Platform,
} from 'react-native';
import { DatePickerModal } from 'react-native-paper-dates';
import { en, registerTranslation } from 'react-native-paper-dates';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { getImageFileFromPicker } from '../../utils/getFormFileFromPicker';
import { fetchDropdownOptions } from '../../utils/fetchDropdownOptions';
import DropDownPicker from 'react-native-dropdown-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LogBox } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

registerTranslation('en', en);
LogBox.ignoreLogs(['VirtualizedLists should never be nested']);

export default function NewAsset() {
  const router = useRouter();
  const { fromAssetId } = useLocalSearchParams();

  // State for asset form fields. Each key corresponds to an asset property.
  const [form, setForm] = useState({
    id: '',                // Asset ID (unique)
    type_id: '',           // Asset type (foreign key)
    serial_number: '',     // Serial number of the asset
    model: '',             // Model name/number
    description: '',       // Description of the asset
    location: '',          // Physical location
    assigned_to_id: '',    // User ID to whom the asset is assigned
    status: '',            // Status (e.g., available, in use)
    next_service_date: '', // Next scheduled service date
  });

  // State for storing the selected asset image
  const [image, setImage] = useState(null);
  // State for storing the attached document (e.g., PDF, manual)
  const [document, setDocument] = useState(null);
  // State for toggling the next service date picker modal
  const [showServicePicker, setShowServicePicker] = useState(false);
  // Dropdown options fetched from backend (asset types, models, users, statuses, asset IDs)
  const [options, setOptions] = useState({ assetTypes: [], models: [], users: [], statuses: [], assetIds: [] });
  // Toggle for showing QR code suggestions
  const [showQRs, setShowQRs] = useState(false);
  // Dropdown open/close state for each dropdown
  const [typeOpen, setTypeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  // Search term for filtering asset IDs
  const [searchTerm, setSearchTerm] = useState('');
  // Filtered asset IDs for QR selection
  const [filteredAssetIds, setFilteredAssetIds] = useState([]);

  // Fetch dropdown options on mount. If copying from an existing asset, prefill fields.
  useEffect(() => {
    fetchDropdownOptions().then((data) => {
      // Log full dropdown data and asset IDs for debugging
      console.log('Fetched dropdown data:', data); // full object
      console.log('Fetched assetIds:', data.assetIds); // just assetIds

      // Set options for dropdowns
      setOptions({
        assetTypes: data.assetTypes || [],
        models: data.models || [],
        users: data.users || [],
        statuses: data.statuses || [],
        assetIds: data.assetIds || [], 
      });
      setFilteredAssetIds(data.assetIds || []);
    });

    // If coming from asset copy, fetch the asset and prefill form fields
    if (fromAssetId) {
      fetch(`http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets/${fromAssetId}`)
        .then(res => res.json())
        .then(data => {
          setForm(f => ({
            ...f,
            type_id: data.type_id || '',
            serial_number: data.serial_number || '',
            model: data.model || '',
            description: data.description || '',
            location: data.location || '',
            assigned_to_id: data.assigned_to_id || '',
            status: data.status || '',
            next_service_date: data.next_service_date?.split('T')[0] || '',
          }));
        })
        .catch(console.error);
    }
  }, []);

  // Handler to update a specific form field
  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Handler to pick an image from device gallery/camera
  const pickImage = async () => {
    const result = await getImageFileFromPicker();
    if (result) setImage(result);
  };

  // Handler to pick a document (PDF, etc.) from device
  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
    if (!result.canceled) setDocument(result.assets[0]);
  };

  // Handler to submit the asset creation form
  const submit = async () => {
    // Log the current form state to the console for debugging
    console.log('📦 Submit called with form:', form);

    // Validate required fields before submitting
    // Ensure that Asset ID, Type, and Serial Number are provided
    if (!form.id || !form.type_id || !form.serial_number ) {
      return Alert.alert('Missing fields', 'Asset ID, Type, Serial and Model are required');
    }

    // Construct a FormData object to send as multipart/form-data
    // This allows uploading files (image/document) along with form fields
    const data = new FormData();
    // Append each form field to the FormData
    Object.entries(form).forEach(([k, v]) => data.append(k, v));
    // If an image is selected, append it to the FormData
    if (image?.file) data.append('image', image.file);
    // If a document is attached, append it to the FormData
    if (document) {
      data.append('document', {
        uri: document.uri, // File URI
        name: document.name || 'document.pdf', // File name
        type: document.mimeType || 'application/pdf', // MIME type
      });
    }

    try {
      // Make a POST request to the backend API to create the asset
      // The endpoint expects multipart/form-data (including files)
      const res = await fetch('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets', {
        method: 'POST',
        body: data,
      });
      if (!res.ok) throw new Error(await res.text());

      Alert.alert('Success', 'Asset created and assigned!');
      router.replace({ pathname: '/Inventory', params: { tab: 'all' } });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    // SafeAreaView ensures content is not hidden by device notches or bars
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* KeyboardAwareScrollView keeps inputs visible when keyboard opens */}
      <KeyboardAwareScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
        extraScrollHeight={80}
        enableOnAndroid
      >
        {/* Header section with back button and title */}
        <View style={{ marginBottom: 20 }}>
          {/* Back button navigates to Inventory tab (all assets) */}
          <TouchableOpacity
            onPress={() => router.replace({ pathname: '/Inventory', params: { tab: 'all' } })}
            style={{ marginBottom: 10 }}
          >
            <Text style={{ color: '#1E90FF', fontWeight: 'bold', fontSize: 16 }}>{'< Back'}</Text>
          </TouchableOpacity>
          {/* Screen title for asset creation */}
          <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 5 }}>
            Create New Asset
          </Text>
          {/* If the user is copying from another asset, show info */}
          {fromAssetId && (
            <Text style={{ textAlign: 'center', marginTop: 6, color: '#888' }}>
              You're copying from asset: <Text style={{ fontWeight: 'bold', color: '#333' }}>{fromAssetId}</Text>
            </Text>
          )}
        </View>
        {/* Show the currently selected Asset ID if chosen */}
        {form.id ? (
          <Text style={{ marginBottom: 10, color: '#333' }}>
            Selected Asset ID: {form.id}
          </Text>
        ) : null}

        {/* Asset ID selection and search section */}
        <Text style={s.label}>Select Asset ID</Text>
        <TextInput
          style={s.input}
          placeholder="Search by ID"
          value={searchTerm}
          // As the user types, filter the asset IDs in the dropdown
          onChangeText={text => {
            setSearchTerm(text);
            const filtered = options.assetIds.filter(item =>
              item.id.toLowerCase().includes(text.toLowerCase())
            );
            setFilteredAssetIds(filtered);
          }}
        />
        <TouchableOpacity onPress={() => setShowQRs(!showQRs)} style={s.qrToggle}>
          <Text style={{ color: '#1E90FF', fontWeight: 'bold' }}>
            {showQRs ? 'Hide QR Options ▲' : 'Show QR Options ▼'}
          </Text>
        </TouchableOpacity>
          
        {showQRs && (
          <View style={s.qrGrid}>
            {filteredAssetIds.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  s.qrCard,
                  form.id === item.id && s.qrCardSelected,
                ]}
                onPress={() => update('id', String(item.id))}

              >
              <View style={{ width: 80, height: 80 }}>
                <Image
                  source={{ uri: `http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/qr/${item.id}.png` }}
                  style={{ width: 80, height: 80 }}
                  resizeMode="contain"
                />
              </View>
                <Text style={s.qrLabel}>{item.id}</Text>
              </TouchableOpacity>
              ))}
         </View>
        )}
        <Text style={s.label}>Asset Type</Text>
          <View style={{ zIndex: 4000 }}>
            <DropDownPicker
              open={typeOpen}
              setOpen={setTypeOpen}
              value={form.type_id}
              setValue={val => update('type_id', val())}
              items={options.assetTypes.map(t => ({ label: t.name, value: t.id }))}
              placeholder="Select Asset Type"
              style={s.dropdown}
              dropDownContainerStyle={s.dropdownContainer}
              nestedScrollEnabled
            />
          </View> 
        <TextInput
          style={s.input}
          placeholder="Serial Number"
          value={form.serial_number}
          onChangeText={t => update('serial_number', t)}
        />
        
        <Text style={s.label}>Model</Text>
        <TextInput
          style={s.input}
          placeholder="Enter Model"
          value={form.model}
          onChangeText={t => update('model', t)}
          />

        <TextInput
          style={[s.input, { height: 80 }]}
          placeholder="Description"
          value={form.description}
          onChangeText={t => update('description', t)}
          multiline
        />
        <TextInput
          style={s.input}
          placeholder="Location"
          value={form.location}
          onChangeText={t => update('location', t)}
        />

        <Text style={s.label}>User Assigned</Text>
        <View style={{ zIndex: 2000 }}>
          <DropDownPicker
            open={userOpen}
            setOpen={setUserOpen}
            value={form.assigned_to_id}
            setValue={val => update('assigned_to_id', val())}
            items={options.users.map(u => ({ label: u.name, value: u.id }))}
            placeholder="Select User"
            style={s.dropdown}
            dropDownContainerStyle={s.dropdownContainer}
            nestedScrollEnabled
          />
        </View>

        <Text style={s.label}>Status</Text>
        <View style={{ zIndex: 1000 }}>
          <DropDownPicker
            open={statusOpen}
            setOpen={setStatusOpen}
            value={form.status}
            setValue={val => update('status', val())}
            items={options.statuses.map(s => ({ label: s, value: s }))}
            placeholder="Select Status"
            style={s.dropdown}
            dropDownContainerStyle={s.dropdownContainer}
            nestedScrollEnabled
          />
        </View>

        <TouchableOpacity style={s.input} onPress={() => setShowServicePicker(true)}>
          <Text style={{ color: form.next_service_date ? '#000' : '#888' }}>
            {form.next_service_date || 'Select Next Service Date'}
          </Text>
        </TouchableOpacity>

        <DatePickerModal
          locale="en"
          mode="single"
          visible={showServicePicker}
          date={form.next_service_date ? new Date(form.next_service_date) : undefined}
          onDismiss={() => setShowServicePicker(false)}
          onConfirm={({ date }) => {
            update('next_service_date', date.toISOString().split('T')[0]);
            setShowServicePicker(false);
          }}
        />

        {image?.uri && <Image source={{ uri: image.uri }} style={s.preview} />}
        <TouchableOpacity style={s.btn} onPress={pickImage}>
          <Text>Pick Image</Text>
        </TouchableOpacity>

        {document && (
          <Text style={{ marginTop: 10, fontStyle: 'italic' }}>
            Attached: {document.name}
          </Text>
        )}
        <TouchableOpacity style={s.btn} onPress={pickDocument}>
          <Text>Attach Document</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.btn, s.submit]} onPress={submit}>
          <Text style={{ color: '#fff' }}>Create Asset</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}


const s = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: Platform.OS === 'ios' ? 20 : 0,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 12,
    marginVertical: 8,
    justifyContent: 'center',
    color: '#000',
  },
  label: {
    marginTop: 10,
    marginBottom: 6,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  btn: {
    backgroundColor: '#eee',
    padding: 15,
    alignItems: 'center',
    borderRadius: 5,
    marginVertical: 8,
  },
  submit: {
    backgroundColor: '#1E90FF',
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 5,
    marginVertical: 10,
  },
  dropdown: {
    borderColor: '#ccc',
    marginBottom: 16,
  },
  dropdownContainer: {
    borderColor: '#ccc',
  },
  qrGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  marginVertical: 10,
},
qrCard: {
  width: '30%',
  backgroundColor: '#f9f9f9',
  padding: 6,
  marginBottom: 10,
  alignItems: 'center',
  borderRadius: 6,
  borderWidth: 1,
  borderColor: '#ccc',
},
qrLabel: {
  marginTop: 4,
  fontSize: 10,
  fontWeight: '600',
},
qrToggle: {
  alignSelf: 'flex-end',
  marginBottom: 4,
  },
qrCardSelected: {
  borderColor: 'green',
  borderWidth: 3,
  backgroundColor: '#d0f0c0',
}


});
