import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const BottomNavigation = ({ navigation }) => {
  return (
    <View style={styles.navigation}>
      <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Overview')}>
        <MaterialIcons name="home" size={24} color="#1E90FF" />
        <Text style={styles.navText}>Overview</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Assets')}>
        <MaterialIcons name="inventory" size={24} color="#1E90FF" />
        <Text style={styles.navText}>Assets</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({ 
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopColor: '#ddd',
    borderTopWidth: 1,
  },
  navItem: {
    alignItems: 'center',
  },
  navText: {
    color: '#1E90FF',
    marginTop: 2,
  },
});

export default BottomNavigation;
