// admin-screen.js - Admin console for bulk and single user registration

// Import React and hooks for state management
import React, { useState } from 'react';
// Import UI components from React Native
import { View, Text, Button, TextInput, Alert, StyleSheet, ScrollView } from 'react-native';
// Import Expo DocumentPicker for CSV file selection
import * as DocumentPicker from 'expo-document-picker'; // Import Expo DocumentPicker for handling CSV file selection

// Import PapaParse for CSV parsing
import Papa from 'papaparse'; // Import PapaParse library for parsing CSV files

// Main AdminScreen component for registration tasks
const AdminScreen = () => {
  // State for parsed emails from CSV, upload result, and manual email input
  const [csvEmails, setCsvEmails] = useState([]); // State variable to store parsed emails from CSV
  const [uploadResult, setUploadResult] = useState(null); // State variable to store result of bulk upload
  const [manualEmail, setManualEmail] = useState(''); // State variable to store manual email input

  // Allowed domains for company employees (adjust as needed)
  const allowedDomains = ['company.com']; // Array of allowed domains for company employees

  // Check if an email belongs to an allowed domain
  const isEmailAllowed = (email) => {
    const domain = email.split('@')[1]?.toLowerCase(); // Extract domain from email
    return allowedDomains.includes(domain); // Check if domain is in allowed list
  };

  // Handle CSV file picking and parsing
  const handleFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv' }); // Open file picker for CSV files
      if (result.type === 'success') {
        const response = await fetch(result.uri); // Fetch selected CSV file
        const csvText = await response.text(); // Read CSV file as text
        // Parse CSV and filter valid emails
        Papa.parse(csvText, {
          complete: (results) => {
            // Flatten results and filter out empty rows
            const parsedEmails = results.data.flat().filter(email => email); // Flatten and filter parsed emails
            // Only accept emails with allowed domains
            const validEmails = parsedEmails.filter(email => isEmailAllowed(email)); // Filter emails by allowed domains
            setCsvEmails(validEmails); // Update state with valid emails
            Alert.alert('CSV Parsed', `Found ${validEmails.length} valid email(s).`); // Display alert with number of valid emails
          },
          error: (error) => {
            Alert.alert('CSV Parsing Error', error.message); // Display alert with parsing error
          },
        });
      }
    } catch (error) {
      Alert.alert('File Pick Error', error.message); // Display alert with file pick error
    }
  };

  // Handle bulk registration of emails from CSV
  const handleBulkSubmit = async () => {
    if (csvEmails.length === 0) {
      Alert.alert('No Emails', 'Please upload a CSV with valid emails.'); // Display alert if no emails are selected
      return;
    }
    try {
      // Replace with your deployed Cloud Function URL
      const response = await fetch(
        'https://us-central1-your-project-id.cloudfunctions.net/bulkCreateAccounts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: csvEmails }), // Send valid emails in request body
        }
      );
      const data = await response.json(); // Parse response data as JSON
      setUploadResult(data); // Update state with upload result
      Alert.alert('Bulk Creation', 'Bulk accounts processed.'); // Display alert with bulk creation result
    } catch (error) {
      Alert.alert('Submission Error', error.message); // Display alert with submission error
    }
  };

  // Handle manual registration of a single email
  const handleManualSubmit = async () => {
    if (!manualEmail) {
      Alert.alert('Input Error', 'Please enter an email.'); // Display alert if no email is entered
      return;
    }
    if (!isEmailAllowed(manualEmail)) {
      Alert.alert('Domain Error', 'Email domain is not allowed.'); // Display alert if email domain is not allowed
      return;
    }
    try {
      // Submit a single email wrapped in an array
      const response = await fetch(
        'https://us-central1-your-project-id.cloudfunctions.net/bulkCreateAccounts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: [manualEmail] }), // Send single email in request body
        }
      );
      const data = await response.json(); // Parse response data as JSON
      Alert.alert('Account Created', `Account created for ${manualEmail}`); // Display alert with account creation result
      setManualEmail(''); // Clear manual email input
    } catch (error) {
      Alert.alert('Submission Error', error.message); // Display alert with submission error
    }
  };

  // Render the admin registration UI
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Admin Console</Text>

      {/* Bulk Account Registration Section */}
      <Text style={styles.sectionTitle}>Bulk Registration (CSV Upload)</Text>
      <Button title="Pick CSV File" onPress={handleFilePick} color="#1E90FF" /> // Button to pick CSV file
      <View style={styles.spacer} />
      <Button title="Submit Bulk Accounts" onPress={handleBulkSubmit} color="#1E90FF" /> // Button to submit bulk accounts
      {uploadResult && (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Bulk Upload Result:</Text>
          <Text>{JSON.stringify(uploadResult, null, 2)}</Text> // Display upload result
        </View>
      )}

      <View style={styles.divider} />

      {/* Single Account Registration Section */}
      <Text style={styles.sectionTitle}>Single Account Registration</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter employee email"
        placeholderTextColor="#888"
        value={manualEmail}
        onChangeText={setManualEmail}
        autoCapitalize="none"
      /> // Input field for manual email entry
      <Button title="Register Account" onPress={handleManualSubmit} color="#1E90FF" /> // Button to register single account
    </ScrollView>
  );
};

// Styles for the admin screen UI
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginVertical: 10,
  },
  spacer: {
    height: 20,
  },
  divider: {
    marginVertical: 30,
    borderBottomColor: '#ccc',
    borderBottomWidth: 1,
    width: '100%',
  },
  resultContainer: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 5,
    width: '100%',
  },
  resultTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    padding: 15,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
});

export default AdminScreen;
