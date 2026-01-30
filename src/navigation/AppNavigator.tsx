import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';

import WelcomeScreen from '../screens/WelcomeScreen';
import PreferencesScreen from '../screens/PreferencesScreen';
import ScanScreen from '../screens/ScanScreen';
import ResultScreen from '../screens/ResultScreen';
import SavedScreen from '../screens/SavedScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#fff' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen
          name="Preferences"
          component={PreferencesScreen}
          options={{
            headerShown: true,
            title: 'Preferences',
            headerTintColor: '#2D7D46',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen name="Scan" component={ScanScreen} />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{
            headerShown: true,
            title: 'Result',
            headerTintColor: '#2D7D46',
            headerBackTitle: 'Scan',
          }}
        />
        <Stack.Screen
          name="Saved"
          component={SavedScreen}
          options={{
            headerShown: true,
            title: '',
            headerTintColor: '#2D7D46',
            headerBackTitle: 'Back',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
