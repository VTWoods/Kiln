import React from 'react';
import { FlatList, StyleSheet, Text, TouchableHighlight, View } from 'react-native';
import {NavigationContainer, NavigationHelpersContext, StackActions} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

class Recipe {
  title: string;
  constructor(myTitle: string) {
    this.title = myTitle;
  }
}

const testRecipes = [
  new Recipe("Hamburgers"),
  new Recipe("Hotdogs")
]

const RecipeListItem = ({navigation, recipe}) => {
  return (
    <TouchableHighlight onPress={() => {navigation.push('RecipeDetails', {recipe: recipe})}}>
        <Text style={styles.button}>{recipe.title}</Text>
    </TouchableHighlight>
  );
}

const RecipeDetails = ({route}) => {
  const { recipe } = route.params;
  return (
    <Text>{recipe.title}</Text>
  );
}

const RecipeList = ({navigation}) => {
  return (
    <View style={styles.container}>
    <FlatList
      data={testRecipes}
      renderItem={({item}) => RecipeListItem({navigation, recipe: item})}/>
  </View>
  );
}

const RecipeBook = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="RecipeList"
        component={RecipeList}
        />
      <Stack.Screen
        name="RecipeDetails"
        component={RecipeDetails}
        />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="RecipeBook" component={RecipeBook} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 22,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#DDDDDD',
    padding: 10,
  },
  item: {
    padding: 10,
    fontSize: 18,
    height: 44,
  },
});
