import React from 'react';
import { FlatList, StyleSheet, Text, TouchableHighlight, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Recipe } from '../proto/recipe_service_pb'

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const RecipeListItem = ({navigation, recipe}) => {
  return (
    <TouchableHighlight onPress={() => {navigation.push('RecipeDetails', {recipe: recipe})}}>
        <Text style={styles.button}>{recipe.getTitle()}</Text>
    </TouchableHighlight>
  );
}

const RecipeDetails = ({route}) => {
  const { recipe } = route.params;
  return (
    <Text>{recipe.getTitle()}</Text>
  );
}

const RecipeList = ({navigation}) => {
  var testRecipes = new Array<Recipe>();
  var newRecipe :Recipe = new Recipe();
  newRecipe.setId(0);
  newRecipe.setTitle("Hamburger");
  testRecipes.push(newRecipe);
  newRecipe = new Recipe();
  newRecipe.setId(1);
  newRecipe.setTitle("Hotdog");
  testRecipes.push(newRecipe);

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

export default RecipeBook;

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
