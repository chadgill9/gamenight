import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getProductByUPC, logScanEvent } from '../lib/supabase';
import { Analytics } from '../lib/analytics';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

export default function ScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualUPC, setManualUPC] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    Analytics.scanStarted();
  }, []);

  const handleBarCodeScanned = async (result: BarcodeScanningResult) => {
    if (scanned || isProcessing) return;

    setScanned(true);
    setIsProcessing(true);

    const upc = result.data;
    await processUPC(upc);
  };

  const processUPC = async (upc: string) => {
    try {
      const product = await getProductByUPC(upc);

      if (product) {
        Analytics.scanSuccess(upc, product.name);
        await logScanEvent({ upc, found: true, fit_score: undefined });
        navigation.navigate('Result', { upc, product });
      } else {
        Analytics.scanNotFound(upc);
        await logScanEvent({ upc, found: false });
        navigation.navigate('Result', { upc, notFound: true });
      }
    } catch (error) {
      console.error('Error processing UPC:', error);
      Alert.alert('Error', 'Failed to look up product. Please try again.');
    } finally {
      setIsProcessing(false);
      setScanned(false);
    }
  };

  const handleManualSubmit = async () => {
    const cleanUPC = manualUPC.trim();
    if (!cleanUPC) {
      Alert.alert('Error', 'Please enter a UPC code');
      return;
    }

    setIsProcessing(true);
    await processUPC(cleanUPC);
    setManualUPC('');
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2D7D46" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionText}>
            SkinSafe needs camera access to scan product barcodes
          </Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setShowManualEntry(true)}
          >
            <Text style={styles.secondaryButtonText}>Enter UPC Manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {showManualEntry ? (
        <View style={styles.manualContainer}>
          <Text style={styles.manualTitle}>Enter UPC Code</Text>
          <TextInput
            style={styles.input}
            value={manualUPC}
            onChangeText={setManualUPC}
            placeholder="e.g., 012345678901"
            keyboardType="number-pad"
            maxLength={14}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, isProcessing && styles.buttonDisabled]}
            onPress={handleManualSubmit}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Look Up Product</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setShowManualEntry(false)}
          >
            <Text style={styles.secondaryButtonText}>Back to Scanner</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            <View style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.scanText}>
                Position barcode within frame
              </Text>
            </View>
          </CameraView>

          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.processingText}>Looking up product...</Text>
            </View>
          )}

          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.manualButton}
              onPress={() => setShowManualEntry(true)}
            >
              <Text style={styles.manualButtonText}>Enter UPC Manually</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.savedButton}
              onPress={() => navigation.navigate('Saved')}
            >
              <Text style={styles.savedButtonText}>View Saved</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  scanFrame: {
    width: 280,
    height: 160,
    borderWidth: 2,
    borderColor: '#2D7D46',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanText: {
    marginTop: 20,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#fff',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#fff',
    gap: 12,
  },
  manualButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D7D46',
    alignItems: 'center',
  },
  manualButtonText: {
    color: '#2D7D46',
    fontSize: 15,
    fontWeight: '600',
  },
  savedButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2D7D46',
    alignItems: 'center',
  },
  savedButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  manualContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  manualTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  button: {
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#2D7D46',
    fontSize: 16,
    fontWeight: '500',
  },
});
