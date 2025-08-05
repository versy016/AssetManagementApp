// new.js - Screen for creating a new asset type

// Import React and useState for component state management
import React, { useState } from 'react';
// Import UI components from React Native
import {
  View,              // Layout container
  Text,              // Text display
  TextInput,         // Input fields
  TouchableOpacity,  // Pressable buttons
  StyleSheet,        // Styling
  Image,             // Image preview
  ScrollView,        // Scrollable content
  Alert,             // Alert popups
} from 'react-native';
// Utility for picking an image from the device
import { getImageFileFromPicker } from '../../../utils/getFormFileFromPicker';
// Router for navigation
import { useRouter } from 'expo-router';
// Safe area view for proper device padding
import { SafeAreaView } from 'react-native-safe-area-context';

// Main component for creating a new asset type
export default function NewAssetType() {
  const router = useRouter(); // Navigation object
  // State for asset type name
  const [name, setName] = useState('');
  // State for selected image (object with uri and file)
  const [image, setImage] = useState(null);

  // Handler to pick an image from device gallery/camera
  const pickImage = async () => {
    const result = await getImageFileFromPicker();
    if (result) {
      setImage(result); // Save the selected image to state
      console.log(' Image selected:', result); // Log for debugging
    }
  };

  // Handler to submit the asset type creation form
  const handleSubmit = async () => {
    // Validate that name and image are provided
    if (!name || !image?.file) {
      return Alert.alert('Missing fields', 'Please enter name and pick an image.');
    }

    // Construct FormData for multipart/form-data POST
    const formData = new FormData();
    formData.append('name', name); // Asset type name
    formData.append('image', image.file); // Image file (cross-platform)

    try {
      // Send POST request to backend API to create asset type
      const res = await fetch('http://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com:3000/assets/asset-types', {
        method: 'POST',
        body: formData,
      });

      // If backend returns error, throw it
      if (!res.ok) throw new Error(await res.text());

      // Show success alert and navigate back to asset types tab
      Alert.alert('Success', 'Asset type created successfully');
      router.replace({ pathname: '/Inventory', params: { tab: 'types' } });
    } catch (err) {
      // Show error alert if upload fails
      console.error('Upload error:', err.message);
      Alert.alert('Error', err.message || 'Failed to create asset type');
    }
  };

  // Render the asset type creation form UI
  return (
    // SafeAreaView ensures content is not hidden by device notches or bars
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* ScrollView allows content to be scrollable if needed */}
      <ScrollView contentContainerStyle={s.container}>
        {/* Back button to return to asset types tab */}
        <TouchableOpacity
          onPress={() => router.replace({ pathname: '/Inventory', params: { tab: 'types' } })}
          style={{ marginBottom: 10 }}
        >
          <Text style={{ color: '#1E90FF', fontWeight: 'bold', fontSize: 16 }}>{'< Back'}</Text>
        </TouchableOpacity>
        {/* Screen title */}
        <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 }}>
          Create New Asset Type
        </Text>
        {/* Asset type name input field */}
        <Text style={s.label}>Name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="Enter asset type name"
        />

        {/* Button to pick/select an image */}
        <TouchableOpacity style={s.btn} onPress={pickImage}>
          <Text>Pick Image</Text>
        </TouchableOpacity>
        {/* Show image preview if one is selected */}
        {image?.uri && <Image source={{ uri: image.uri }} style={s.preview} />}

        {/* Submit button to create asset type */}
        <TouchableOpacity style={[s.btn, s.submit]} onPress={handleSubmit}>
          <Text style={{ color: '#fff' }}>Create Asset Type</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// Styles for the asset type creation screen
const s = StyleSheet.create({
  container: { padding: 20 }, // Main container padding
  input: {
    borderWidth: 1,         // Input border thickness
    borderColor: '#ccc',    // Input border color
    borderRadius: 5,        // Rounded corners
    padding: 12,            // Padding inside input
    marginVertical: 8,      // Vertical spacing between inputs
    justifyContent: 'center',
  },
  btn: {
    backgroundColor: '#eee', // Button background color
    padding: 15,             // Button padding
    alignItems: 'center',    // Center button content
    borderRadius: 5,         // Rounded corners
    marginVertical: 8,       // Vertical spacing between buttons
  },
  submit: { backgroundColor: '#1E90FF' }, // Submit button color
  preview: {
    width: '100%',           // Image preview width
    height: 200,             // Image preview height
    borderRadius: 5,         // Rounded corners for preview
    marginVertical: 10,      // Vertical spacing for preview
  },
  label: {
    fontSize: 16,            // Label font size
    fontWeight: 'bold',      // Label font weight
    marginBottom: 5,         // Spacing between label and input
  },
});
