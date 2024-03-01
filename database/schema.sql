CREATE TABLE `recipes` (
    `recipe_id` int NOT NULL,
    `title` varchar(100) NOT NULL,
    `content_blob` varchar(1000),
    PRIMARY KEY ('recipe_id')
);
