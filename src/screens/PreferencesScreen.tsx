import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Switch,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserPreferences } from '../types';
import { AVAILABLE_AVOID_TAGS } from '../lib/scoring';
import { Analytics } from '../lib/analytics';

type Props = NativeStackScreenProps<RootStackParamList, 'Preferences'>;

const PREFERENCES_KEY = '@skinsafe_preferences';

export default function PreferencesScreen({ navigation }: Props) {
  const [fragranceFree, setFragranceFree] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        const prefs: UserPreferences = JSON.parse(stored);
        setFragranceFree(prefs.fragrance_free);
        setSelectedTags(prefs.avoid_tags);
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  };

  const savePreferences = async () => {
    try {
      const prefs: UserPreferences = {
        fragrance_free: fragranceFree,
        avoid_tags: selectedTags,
      };
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
      Analytics.onboardingCompleted();
      navigation.navigate('Scan');
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Your Preferences</Text>
        <Text style={styles.subtitle}>
          Tell us what you'd like to avoid. We'll flag products that may contain these ingredients.
        </Text>

        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Fragrance-Free</Text>
              <Text style={styles.toggleDescription}>
                Flag products with fragrance, parfum, or essential oils
              </Text>
            </View>
            <Switch
              value={fragranceFree}
              onValueChange={setFragranceFree}
              trackColor={{ false: '#E0E0E0', true: '#A5D6A7' }}
              thumbColor={fragranceFree ? '#2D7D46' : '#f4f3f4'}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingredients to Avoid</Text>
          <Text style={styles.sectionDescription}>
            Select ingredients you prefer to avoid (optional)
          </Text>
          <View style={styles.tagsContainer}>
            {AVAILABLE_AVOID_TAGS.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.tag, selectedTags.includes(tag) && styles.tagSelected]}
                onPress={() => toggleTag(tag)}
              >
                <Text
                  style={[styles.tagText, selectedTags.includes(tag) && styles.tagTextSelected]}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.button} onPress={savePreferences}>
          <Text style={styles.buttonText}>Save & Start Scanning</Text>
        </TouchableOpacity>
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
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 32,
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F8F8',
    padding: 16,
    borderRadius: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 13,
    color: '#888',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  tagSelected: {
    backgroundColor: '#E8F5E9',
    borderColor: '#2D7D46',
  },
  tagText: {
    fontSize: 14,
    color: '#666',
  },
  tagTextSelected: {
    color: '#2D7D46',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
