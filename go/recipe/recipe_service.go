package recipe

import (
	"context"
	"database/sql"

	recipepb "github.com/VTWoods/kiln/proto"
	"google.golang.org/grpc"
)

type recipeServer struct {
	recipeBook *RecipeBook
	recipepb.UnimplementedRecipeServiceServer
}

func (s *recipeServer) AddRecipe(ctx context.Context, request *recipepb.AddRecipeRequest) (*recipepb.AddRecipeResponse, error) {
	new_id, err := s.recipeBook.AddRecipe(request.Recipe)
	if err != nil {
		return nil, err
	}
	return &recipepb.AddRecipeResponse{RecipeId: new_id}, nil
}

func (s *recipeServer) ListRecipes(ctx context.Context, request *recipepb.ListRecipesRequest) (*recipepb.ListRecipesResponse, error) {
	recipes, err := s.recipeBook.ListRecipes()
	if err != nil {
		return nil, err
	}
	return &recipepb.ListRecipesResponse{Recipes: recipes}, nil
}

func RegisterService(grpcServer *grpc.Server, kilnDB *sql.DB) {
	recipeBook := &RecipeBook{db: kilnDB}
	recipepb.RegisterRecipeServiceServer(grpcServer, &recipeServer{recipeBook: recipeBook})
}
