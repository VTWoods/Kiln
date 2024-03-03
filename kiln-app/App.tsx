import { StatusBar } from 'expo-status-bar';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { isConstructorDeclaration } from 'typescript';
import { ListItem } from '@rneui/themed'

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

const RecipeBook = () => {
  return (
    <View style={styles.container}>
      {
        testRecipes.map((item, i) =>(
          <ListItem key={i} bottomDivider>
            <ListItem.Content>
              <ListItem.Title>{item.title}</ListItem.Title>
            </ListItem.Content>
            <ListItem.Chevron/>
          </ListItem>
        ))
      }
    </View>
  );
}

export default function App() {
  return (
    <RecipeBook/>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 22,
  },
  item: {
    padding: 10,
    fontSize: 18,
    height: 44,
  },
});
