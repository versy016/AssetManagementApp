import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const Header = () => {
  return (
    <View style={styles.header}>
      <Text style={styles.headerText}>Eng Surveys</Text>
      <View style={styles.headerRight}>
        <TouchableOpacity><Text style={styles.headerButton}>Account</Text></TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1E90FF',
  },
  headerText: {
    fontSize: 18,
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
  },
  headerButton: {
    color: '#fff',
    marginLeft: 10,
  },
});

export default Header;
