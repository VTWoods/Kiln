CREATE TABLE `recipes` (
    `id` varchar(32) NOT NULL,
    `title` varchar(100) NOT NULL,
    `content_blob` varchar(1000),
    PRIMARY KEY ('id')
);
