// AssetsStack.js - Navigation stack for asset-related screens

// Import React for component definition
import React from 'react';
// Import asset-related screens
import Assets from './assets';
import NewAsset from './new';
import Inventory from '../(tabs)/Inventory';

// AssetsStack component defines navigation for asset management
export default function AssetsStack() {
  return (
    // Stack.Navigator manages navigation between asset screens
    <Stack.Navigator>
      {/* Main assets list screen */}
      <Stack.Screen name="Assets" component={Assets} options={{ headerShown: false }} />
      {/* Screen for adding a new asset */}
      <Stack.Screen name="NewAsset" component={NewAsset} options={{ headerShown: false }} />
      {/* Inventory overview screen */}
      <Stack.Screen name="Inventory" component={Inventory} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
