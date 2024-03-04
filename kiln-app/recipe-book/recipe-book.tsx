import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableHighlight, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

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
  const [recipes, setRecipes] = useState({recipes: []});
  useEffect(() => {
    fetch("http://localhost:8084/RecipeService/ListRecipes",
    {
      method: "POST",
    })
    .then(response => response.json())
    .then(data => setRecipes(data));
  })

  return (
    <View style={styles.container}>
    <FlatList
      data={recipes.recipes}
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
