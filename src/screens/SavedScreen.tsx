import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, SavedProduct } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Saved'>;

const SAVED_PRODUCTS_KEY = '@skinsafe_saved_products';

export default function SavedScreen({ navigation }: Props) {
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadSavedProducts();
    }, [])
  );

  const loadSavedProducts = async () => {
    try {
      const stored = await AsyncStorage.getItem(SAVED_PRODUCTS_KEY);
      if (stored) {
        setSavedProducts(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading saved products:', error);
    }
  };

  const handleRemoveProduct = (upc: string, name: string) => {
    Alert.alert(
      'Remove Product',
      `Are you sure you want to remove "${name}" from your saved list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const filtered = savedProducts.filter((p) => p.upc !== upc);
              await AsyncStorage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(filtered));
              setSavedProducts(filtered);
            } catch (error) {
              console.error('Error removing product:', error);
            }
          },
        },
      ]
    );
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#2D7D46';
    if (score >= 60) return '#F9A825';
    return '#D32F2F';
  };

  const renderProduct = ({ item }: { item: SavedProduct }) => (
    <TouchableOpacity
      style={styles.productCard}
      onLongPress={() => handleRemoveProduct(item.upc, item.name)}
    >
      <View style={styles.productInfo}>
        <Text style={styles.productName}>{item.name}</Text>
        <Text style={styles.productBrand}>{item.brand}</Text>
        {item.flags.length > 0 && (
          <Text style={styles.productFlags} numberOfLines={1}>
            {item.flags[0]}
          </Text>
        )}
      </View>
      <View style={styles.scoreContainer}>
        <Text style={[styles.scoreText, { color: getScoreColor(item.fitScore) }]}>
          {item.fitScore}
        </Text>
        <Text style={styles.confidenceLabel}>{item.confidence}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved Products</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Scan')}>
          <Text style={styles.scanLink}>+ Scan</Text>
        </TouchableOpacity>
      </View>

      {savedProducts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>*</Text>
          <Text style={styles.emptyTitle}>No Saved Products</Text>
          <Text style={styles.emptyText}>
            Products you save will appear here for quick reference.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('Scan')}
          >
            <Text style={styles.buttonText}>Start Scanning</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Long press to remove a product</Text>
          <FlatList
            data={savedProducts}
            renderItem={renderProduct}
            keyExtractor={(item) => item.upc}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  scanLink: {
    fontSize: 16,
    color: '#2D7D46',
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginBottom: 12,
  },
  listContent: {
    padding: 16,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  productBrand: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  productFlags: {
    fontSize: 13,
    color: '#F9A825',
  },
  scoreContainer: {
    alignItems: 'center',
    marginLeft: 16,
  },
  scoreText: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  confidenceLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F5F5F5',
    textAlign: 'center',
    lineHeight: 80,
    fontSize: 40,
    color: '#CCC',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
