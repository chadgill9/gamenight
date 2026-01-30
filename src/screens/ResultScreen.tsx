import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserPreferences, SavedProduct, Product } from '../types';
import { calculateScore } from '../lib/scoring';
import { addProduct } from '../lib/supabase';
import { Analytics } from '../lib/analytics';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

const PREFERENCES_KEY = '@skinsafe_preferences';
const SAVED_PRODUCTS_KEY = '@skinsafe_saved_products';

export default function ResultScreen({ route, navigation }: Props) {
  const { upc, product, notFound } = route.params;
  const [preferences, setPreferences] = useState<UserPreferences>({
    fragrance_free: false,
    avoid_tags: [],
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', brand: '', ingredients: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<Product | undefined>(product);

  useEffect(() => {
    loadPreferences();
  }, []);

  useEffect(() => {
    if (currentProduct) {
      const result = calculateScore(preferences, currentProduct.ingredients_raw_text);
      Analytics.resultViewed(upc, result.fitScore, result.confidence);
    }
  }, [currentProduct, preferences]);

  const loadPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        setPreferences(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  };

  const handleSaveProduct = async () => {
    if (!currentProduct) return;

    const result = calculateScore(preferences, currentProduct.ingredients_raw_text);

    const savedProduct: SavedProduct = {
      upc,
      name: currentProduct.name,
      brand: currentProduct.brand,
      fitScore: result.fitScore,
      flags: result.flags,
      confidence: result.confidence,
      savedAt: new Date().toISOString(),
    };

    try {
      const stored = await AsyncStorage.getItem(SAVED_PRODUCTS_KEY);
      const savedProducts: SavedProduct[] = stored ? JSON.parse(stored) : [];

      // Remove existing if present (update)
      const filtered = savedProducts.filter((p) => p.upc !== upc);
      filtered.unshift(savedProduct);

      await AsyncStorage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(filtered));

      Analytics.saveProduct(upc, currentProduct.name, result.fitScore);

      Alert.alert('Saved', `${currentProduct.name} has been saved to your list.`, [
        { text: 'OK' },
      ]);
    } catch (error) {
      console.error('Error saving product:', error);
      Alert.alert('Error', 'Failed to save product. Please try again.');
    }
  };

  const handleSubmitProduct = async () => {
    if (!newProduct.name.trim() || !newProduct.brand.trim() || !newProduct.ingredients.trim()) {
      Alert.alert('Missing Information', 'Please fill in all fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      const addedProduct = await addProduct(
        upc,
        newProduct.name.trim(),
        newProduct.brand.trim(),
        newProduct.ingredients.trim()
      );

      if (addedProduct) {
        Analytics.productSubmitted(upc, newProduct.name);
        setCurrentProduct(addedProduct);
        setShowAddModal(false);
        setNewProduct({ name: '', brand: '', ingredients: '' });
        Alert.alert('Thank You!', 'Product submitted successfully.');
      } else {
        Alert.alert('Error', 'Failed to submit product. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting product:', error);
      Alert.alert('Error', 'Failed to submit product. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render not found state
  if (notFound && !currentProduct) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundIcon}>?</Text>
          <Text style={styles.notFoundTitle}>Product Not Found</Text>
          <Text style={styles.notFoundText}>
            UPC: {upc}
          </Text>
          <Text style={styles.notFoundSubtext}>
            We don't have this product in our database yet. Would you like to add it?
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => setShowAddModal(true)}
          >
            <Text style={styles.buttonText}>Add Product</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Scan')}
          >
            <Text style={styles.secondaryButtonText}>Scan Another</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Product</Text>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <Text style={styles.inputLabel}>Product Name</Text>
              <TextInput
                style={styles.input}
                value={newProduct.name}
                onChangeText={(text) => setNewProduct((p) => ({ ...p, name: text }))}
                placeholder="e.g., Gentle Cleanser"
              />

              <Text style={styles.inputLabel}>Brand</Text>
              <TextInput
                style={styles.input}
                value={newProduct.brand}
                onChangeText={(text) => setNewProduct((p) => ({ ...p, brand: text }))}
                placeholder="e.g., CeraVe"
              />

              <Text style={styles.inputLabel}>Ingredients</Text>
              <Text style={styles.inputHint}>
                Copy the full ingredient list from the product packaging
              </Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={newProduct.ingredients}
                onChangeText={(text) => setNewProduct((p) => ({ ...p, ingredients: text }))}
                placeholder="e.g., Water, Glycerin, Niacinamide..."
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.button, isSubmitting && styles.buttonDisabled]}
                onPress={handleSubmitProduct}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Submit Product</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );
  }

  // Calculate score for found product
  const result = currentProduct
    ? calculateScore(preferences, currentProduct.ingredients_raw_text)
    : null;

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#2D7D46';
    if (score >= 60) return '#F9A825';
    return '#D32F2F';
  };

  const getConfidenceBadge = (confidence: string) => {
    const colors = {
      HIGH: { bg: '#E8F5E9', text: '#2D7D46' },
      MED: { bg: '#FFF8E1', text: '#F9A825' },
      LOW: { bg: '#FFEBEE', text: '#D32F2F' },
    };
    return colors[confidence as keyof typeof colors] || colors.MED;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {currentProduct && result && (
          <>
            <View style={styles.productHeader}>
              <Text style={styles.productName}>{currentProduct.name}</Text>
              <Text style={styles.productBrand}>{currentProduct.brand}</Text>
            </View>

            <View style={styles.scoreSection}>
              <View style={styles.scoreCircle}>
                <Text style={[styles.scoreNumber, { color: getScoreColor(result.fitScore) }]}>
                  {result.fitScore}
                </Text>
                <Text style={styles.scoreLabel}>Fit Score</Text>
              </View>

              <View
                style={[
                  styles.confidenceBadge,
                  { backgroundColor: getConfidenceBadge(result.confidence).bg },
                ]}
              >
                <Text
                  style={[
                    styles.confidenceText,
                    { color: getConfidenceBadge(result.confidence).text },
                  ]}
                >
                  {result.confidence} Confidence
                </Text>
              </View>
            </View>

            {result.flags.length > 0 && (
              <View style={styles.flagsSection}>
                <Text style={styles.sectionTitle}>Flags</Text>
                {result.flags.map((flag, index) => (
                  <View key={index} style={styles.flagItem}>
                    <Text style={styles.flagIcon}>!</Text>
                    <Text style={styles.flagText}>{flag}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.disclaimerSection}>
              <Text style={styles.disclaimerText}>
                Results are for informational purposes only and based on your personal preferences.
                Consult a dermatologist for skin concerns.
              </Text>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.button} onPress={handleSaveProduct}>
                <Text style={styles.buttonText}>Save Product</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('Scan')}
              >
                <Text style={styles.secondaryButtonText}>Scan Another</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  productHeader: {
    marginBottom: 32,
  },
  productName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  productBrand: {
    fontSize: 18,
    color: '#888',
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  scoreCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    borderColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreNumber: {
    fontSize: 48,
    fontWeight: 'bold',
  },
  scoreLabel: {
    fontSize: 14,
    color: '#888',
  },
  confidenceBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  confidenceText: {
    fontSize: 14,
    fontWeight: '600',
  },
  flagsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  flagItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  flagIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F9A825',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: 'bold',
    marginRight: 12,
    fontSize: 14,
  },
  flagText: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
  disclaimerSection: {
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  disclaimerText: {
    fontSize: 13,
    color: '#888',
    lineHeight: 20,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  button: {
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
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
    borderWidth: 1,
    borderColor: '#2D7D46',
    borderRadius: 12,
  },
  secondaryButtonText: {
    color: '#2D7D46',
    fontSize: 16,
    fontWeight: '600',
  },
  notFoundContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  notFoundIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F5F5F5',
    textAlign: 'center',
    lineHeight: 80,
    fontSize: 40,
    color: '#888',
    marginBottom: 24,
  },
  notFoundTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  notFoundText: {
    fontSize: 16,
    color: '#888',
    marginBottom: 8,
  },
  notFoundSubtext: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalCancel: {
    fontSize: 16,
    color: '#2D7D46',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  modalContent: {
    flex: 1,
    padding: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inputHint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  textArea: {
    height: 150,
    textAlignVertical: 'top',
  },
});
